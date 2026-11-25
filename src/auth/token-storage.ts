import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { jwtDecode } from "jwt-decode";

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  /** "web": issued by our backend; absent for older Cognito logins. */
  kind?: "web";
  /** Where to refresh web tokens, and the site they belong to. */
  apiUrl?: string;
  siteName?: string;
}

/** Refresh this long before the token runs out. */
const REFRESH_AHEAD_MS = 60 * 1000;

const CONFIG_DIR = path.join(os.homedir(), ".flutch");
const TOKEN_FILE = path.join(CONFIG_DIR, "credentials.json");

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Save tokens to local storage
 */
export function saveTokens(tokens: TokenData): void {
  ensureConfigDir();
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), {
    mode: 0o600,
  });
}

/**
 * Load tokens from local storage
 */
export function loadTokens(): TokenData | null {
  if (!fs.existsSync(TOKEN_FILE)) {
    return null;
  }

  try {
    const data = fs.readFileSync(TOKEN_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Failed to load tokens:", error);
    return null;
  }
}

/**
 * Clear stored tokens
 */
export function clearTokens(): void {
  if (fs.existsSync(TOKEN_FILE)) {
    fs.unlinkSync(TOKEN_FILE);
  }
}

/**
 * Check if tokens are expired
 */
export function isTokenExpired(tokens: TokenData): boolean {
  return Date.now() >= tokens.expiresAt - REFRESH_AHEAD_MS;
}

/**
 * Get valid ID token (auto-refresh if needed)
 * ID token is used for authentication with the backend
 */
export async function getValidIdToken(): Promise<string | null> {
  const tokens = loadTokens();

  if (!tokens) {
    return null;
  }

  // If token is not expired, return it
  if (!isTokenExpired(tokens)) {
    return tokens.idToken;
  }

  // Token is expired, try to refresh
  try {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    return refreshed.idToken;
  } catch (error) {
    console.error("Failed to refresh token:", error);
    clearTokens();
    return null;
  }
}

/**
 * Get valid access token (auto-refresh if needed)
 */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = loadTokens();

  if (!tokens) {
    return null;
  }

  // If token is not expired, return it
  if (!isTokenExpired(tokens)) {
    return tokens.accessToken;
  }

  // Token is expired, try to refresh
  try {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    return refreshed.accessToken;
  } catch (error) {
    console.error("Failed to refresh token:", error);
    clearTokens();
    return null;
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string,
  cognitoClientId?: string,
  cognitoRegion?: string
): Promise<TokenData> {
  const stored = loadTokens();
  if (stored?.kind === "web" && stored.apiUrl) {
    return refreshWebTokens(stored);
  }

  // Try to get config from auth-config if not provided
  if (!cognitoClientId || !cognitoRegion) {
    try {
      const { getAuthConfig } = await import("../config/auth-config");
      const authConfig = getAuthConfig();
      if (authConfig) {
        cognitoClientId = cognitoClientId || authConfig.cognitoClientId;
        cognitoRegion = cognitoRegion || authConfig.cognitoRegion;
      }
    } catch (error) {
      // Ignore if config not available
    }
  }

  if (!cognitoClientId || !cognitoRegion) {
    throw new Error("Cognito configuration not available for token refresh");
  }

  const { CognitoIdentityProviderClient, InitiateAuthCommand } =
    await import("@aws-sdk/client-cognito-identity-provider");

  const client = new CognitoIdentityProviderClient({
    region: cognitoRegion,
  });

  const command = new InitiateAuthCommand({
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: cognitoClientId,
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  });

  const response = await client.send(command);

  if (!response.AuthenticationResult?.AccessToken || !response.AuthenticationResult?.IdToken) {
    throw new Error("Failed to refresh token");
  }

  const accessToken = response.AuthenticationResult.AccessToken;
  const idToken = response.AuthenticationResult.IdToken;
  const expiresIn = response.AuthenticationResult.ExpiresIn || 3600;

  const newTokens: TokenData = {
    accessToken,
    idToken,
    refreshToken, // Keep the same refresh token
    expiresAt: Date.now() + expiresIn * 1000,
  };

  saveTokens(newTokens);
  return newTokens;
}

/** New tokens from our backend; the refresh token is replaced each time. */
async function refreshWebTokens(stored: TokenData): Promise<TokenData> {
  const res = await fetch(`${stored.apiUrl!.replace(/\/$/, "")}/public/auth/refresh`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-site-name": stored.siteName || "flutch",
    },
    body: JSON.stringify({ refreshToken: stored.refreshToken }),
  });
  if (!res.ok) {
    throw new Error(`Session expired (HTTP ${res.status}). Run: flutch login`);
  }
  const body = (await res.json()) as {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
  };
  const next: TokenData = {
    ...stored,
    accessToken: body.accessToken,
    idToken: body.accessToken,
    refreshToken: body.refreshToken ?? stored.refreshToken,
    expiresAt: Date.now() + body.expiresIn * 1000,
  };
  saveTokens(next);
  return next;
}

/**
 * Extract user info from ID token
 */
export function getUserFromToken(idToken: string): any {
  try {
    return jwtDecode(idToken);
  } catch (error) {
    console.error("Failed to decode token:", error);
    return null;
  }
}
