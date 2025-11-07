import axios, { AxiosInstance, AxiosResponse, AxiosError } from "axios";
import chalk from "chalk";
import { getValidIdToken, loadTokens, refreshAccessToken, clearTokens } from "../auth/token-storage";

export interface FlutchConfig {
  apiUrl: string;
  apiKey: string;
  environment: string;
  siteName?: string;
  companyId?: string;
  companySlug?: string;
  userEmail?: string;
}

export interface GraphManifest {
  graphType?: string;
  baseType?: string;
  companyId?: string;
  name: string;
  graphVersion?: string;
  title: string;
  description: string;
  status?: "development" | "beta" | "stable" | "deprecated";
  configSchema?: any;
  author?: string;
  changelog?: string[];
  visibility?: "public" | "private" | "corporate";
  // UI configuration for graph apps
  ui?: {
    enabled: boolean;
    title?: string;
    description?: string;
    defaultScreen?: string;
    menu?: string[];
    screens?: Record<string, any>;
    theme?: Record<string, any>;
    permissions?: {
      read: string[];
      write: string[];
    };
  };
  // Model type constraints for validation
  modelTypes?: {
    required?: ModelTypeConstraint[];
    optional?: ModelTypeConstraint[];
  };
}

export interface ModelTypeConstraint {
  // The field path in config schema where model is specified
  configPath: string;
  // Required model type for this configuration field
  modelType: "chat" | "rerank" | "embedding" | "image" | "speech";
  // Optional description for validation errors
  description?: string;
}

export interface GraphCatalogItem {
  _id: string;
  graphType: string;
  baseType: string;
  companyId: string;
  name: string;
  graphVersion: string;
  title: string;
  description: string;
  status: "development" | "beta" | "stable" | "deprecated";
  releaseDate?: Date;
  author?: string;
  changelog?: string[];
  visibility: "public" | "private" | "corporate";
  configSchema?: any;
}

export interface ModelCatalogItem {
  id: string;
  provider: string;
  modelName: string;
  modelType: string;
  companyId: string;
  siteName: string;
  visibility: string;
  requiresApiKey: boolean;
  isActive: boolean;
  pricing: {
    inputTokensCost: number;
    outputTokensCost: number;
    minCost: number;
    baseInput: number;
    baseOutput: number;
  };
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  maxDocuments?: number;
  supportedLanguages?: string[];
  maxQueryLength?: number;
  dimensions?: number;
  createdAt?: Date;
  updatedAt?: Date;
  version?: number;
}

export class ApiClient {
  private axios: AxiosInstance;
  private refreshPromise: Promise<void> | null = null;

  constructor(private config: FlutchConfig) {
    this.axios = axios.create({
      baseURL: config.apiUrl,
      headers: {
        "x-internal-token": config.apiKey,
        "x-site-name": config.siteName || "flutch",
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    // Add request interceptor for logging and JWT token injection
    this.axios.interceptors.request.use(async config => {
      console.log(chalk.dim(`→ ${config.method?.toUpperCase()} ${config.url}`));

      // Try to get JWT ID token (if user is logged in via OAuth)
      // We use ID token instead of access token because backend verifier expects tokenUse: "id"
      const token = await getValidIdToken();
      if (token) {
        // Use JWT token instead of x-internal-token
        config.headers.Authorization = `Bearer ${token}`;
        delete config.headers["x-internal-token"];
      }

      return config;
    });

    // Add response interceptor for error handling and token refresh
    this.axios.interceptors.response.use(
      response => response,
      async (error: AxiosError) => {
        // Check if we should attempt token refresh
        if (this.shouldRefreshToken(error)) {
          // Check if we have a refresh token
          const tokens = loadTokens();
          if (tokens?.refreshToken && tokens.refreshToken !== "") {
            try {
              // Try to refresh token (only once)
              await this.refreshAuthToken();

              // Retry the original request with new ID token
              const token = await getValidIdToken();
              if (token && error.config) {
                error.config.headers.Authorization = `Bearer ${token}`;
                delete error.config.headers["x-internal-token"];
                return this.axios.request(error.config);
              }
            } catch (refreshError) {
              // Token refresh failed - clear tokens and let user know
              clearTokens();
              console.error(
                chalk.red("✗ Authentication failed:"),
                "Token expired. Please login again with 'flutch login'"
              );
              throw refreshError;
            }
          } else {
            // No refresh token - just clear and inform user
            clearTokens();
            console.error(
              chalk.red("✗ Authentication failed:"),
              "Token expired. Please login again with 'flutch login'"
            );
          }
        }

        // Handle errors
        if (error.response) {
          const { status, data } = error.response;
          const errorData = data as any;
          console.error(
            chalk.red(`✗ API Error ${status}:`),
            errorData?.message || data
          );
        } else if (error.request) {
          console.error(
            chalk.red("✗ Network Error:"),
            "Unable to reach API server"
          );
        } else {
          console.error(chalk.red("✗ Request Error:"), error.message);
        }
        throw error;
      }
    );
  }

  /**
   * Check if we should attempt token refresh
   */
  private shouldRefreshToken(error: AxiosError): boolean {
    // Only attempt refresh once per error (check if we already have a refresh in progress)
    if (this.refreshPromise) {
      return false;
    }

    // Only attempt refresh if we have tokens and request used JWT auth
    const usedJwtAuth = error.config?.headers?.Authorization?.toString().startsWith('Bearer ');
    if (!usedJwtAuth) {
      return false;
    }

    // Check if this is a token expiration error (401)
    return error.response?.status === 401;
  }

  /**
   * Refresh authentication token (with race condition protection)
   */
  private async refreshAuthToken(): Promise<void> {
    // Protect from race condition - only one refresh at a time
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const tokens = loadTokens();
        if (!tokens?.refreshToken) {
          throw new Error("No refresh token available");
        }

        await refreshAccessToken(tokens.refreshToken);
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Register a graph from manifest
   * Uses admin endpoint with JWT authentication
   */
  async registerGraph(manifest: GraphManifest): Promise<GraphCatalogItem> {
    const response: AxiosResponse<GraphCatalogItem> = await this.axios.post(
      "/admin/graph-catalog/register",
      manifest
    );
    return response.data;
  }

  /**
   * Validate a graph manifest
   * Uses admin endpoint with JWT authentication
   */
  async validateManifest(
    manifest: GraphManifest
  ): Promise<{ valid: boolean; errors?: string[] }> {
    const response: AxiosResponse<{ isValid: boolean; errors?: string[] }> =
      await this.axios.post("/admin/graph-catalog/validate", manifest);
    return {
      valid: response.data.isValid,
      errors: response.data.errors,
    };
  }

  /**
   * Update graph status (publish/unpublish)
   * Uses admin endpoint with JWT authentication
   */
  async updateGraphStatus(
    graphType: string,
    status: "development" | "beta" | "stable" | "deprecated"
  ): Promise<GraphCatalogItem> {
    const response: AxiosResponse<GraphCatalogItem> = await this.axios.patch(
      `/admin/graph-catalog/${encodeURIComponent(graphType)}/status`,
      { status }
    );
    return response.data;
  }

  /**
   * List all graphs or versions of specific base type
   * Uses admin endpoint with JWT authentication
   */
  async listGraphs(
    baseType?: string,
    scope?: "my-company" | "all"
  ): Promise<GraphCatalogItem[]> {
    const url = baseType
      ? `/admin/graph-catalog/versions`
      : "/admin/graph-catalog";

    const params: any = scope ? { scope } : {};
    if (baseType) {
      params.baseType = baseType;
    }

    const response: AxiosResponse<{
      items: GraphCatalogItem[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }> = await this.axios.get(url, { params });
    return response.data.items;
  }

  /**
   * Get specific graph details
   * Uses admin endpoint with JWT authentication
   */
  async getGraph(graphType: string): Promise<GraphCatalogItem> {
    const response: AxiosResponse<GraphCatalogItem> = await this.axios.get(
      `/admin/graph-catalog/${encodeURIComponent(graphType)}`
    );
    return response.data;
  }

  /**
   * Update graph from manifest
   * Uses admin endpoint with JWT authentication
   */
  async updateGraph(
    graphType: string,
    manifest: GraphManifest
  ): Promise<GraphCatalogItem> {
    const response: AxiosResponse<GraphCatalogItem> = await this.axios.put(
      `/admin/graph-catalog/${encodeURIComponent(graphType)}`,
      manifest
    );
    return response.data;
  }

  /**
   * Add a new model to the catalog
   * Uses admin endpoint with JWT authentication
   */
  async addModelToCatalog(modelData: any): Promise<ModelCatalogItem> {
    const response: AxiosResponse<ModelCatalogItem> = await this.axios.post(
      "/admin/model-catalog",
      modelData
    );
    return response.data;
  }

  /**
   * List models from the catalog
   * Uses admin endpoint with JWT authentication
   */
  async listModels(queryParams?: any): Promise<ModelCatalogItem[]> {
    const response: AxiosResponse<ModelCatalogItem[]> = await this.axios.get(
      "/admin/model-catalog",
      { params: queryParams }
    );
    return response.data;
  }
}
