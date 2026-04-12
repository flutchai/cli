import { promises as fs } from "fs";
import * as path from "path";

/** Custom UI-only field types that have no plain config value */
const CUSTOM_TYPES = new Set(["modelConfig", "credentials", "oauth", "agentSelector"]);

export interface ManifestVersion {
  configSchemaPath: string;
  status?: string;
  [key: string]: any;
}

export interface GraphManifest {
  name: string;
  versioning?: { defaultVersion?: string };
  versions?: Record<string, ManifestVersion>;
  [key: string]: any;
}

/**
 * Find graph.manifest.<name>.json for a given graphType (e.g. "flutch.sales").
 * Searches the directory that contains agents.json.
 */
export async function findManifest(
  graphType: string,
  agentsDir: string
): Promise<{ manifest: GraphManifest; dir: string } | null> {
  const typeName = graphType.split(".").pop()!;
  const fileName = `graph.manifest.${typeName}.json`;
  const filePath = path.join(agentsDir, fileName);

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return { manifest: JSON.parse(raw), dir: agentsDir };
  } catch {
    return null;
  }
}

/**
 * Recursively extract { key: defaultValue } from a JSON Schema's properties tree.
 * Skips properties with custom/non-standard types.
 */
export function extractSchemaDefaults(schema: any): Record<string, any> {
  const result: Record<string, any> = {};
  if (!schema?.properties) return result;

  for (const [key, prop] of Object.entries<any>(schema.properties)) {
    if (CUSTOM_TYPES.has(prop.type)) continue;

    if (prop.type === "object" && prop.properties) {
      if (prop.default !== undefined) {
        result[key] = prop.default;
      } else {
        const nested = extractSchemaDefaults(prop);
        if (Object.keys(nested).length > 0) result[key] = nested;
      }
    } else if (prop.default !== undefined) {
      result[key] = prop.default;
    }
  }

  return result;
}

/**
 * Load and parse the JSON Schema for the manifest's default version.
 * Returns null if the manifest has no default version or the file is missing.
 */
export async function loadManifestSchema(
  manifest: GraphManifest,
  manifestDir: string
): Promise<any | null> {
  const defaultVersion = manifest.versioning?.defaultVersion;
  if (!defaultVersion || !manifest.versions?.[defaultVersion]) return null;

  const schemaRelPath = manifest.versions[defaultVersion].configSchemaPath;
  const schemaPath = path.resolve(manifestDir, schemaRelPath);

  try {
    const raw = await fs.readFile(schemaPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Find the systemPrompt default anywhere in the extracted defaults tree.
 * Checks root first, then one level deep (e.g. conversation.systemPrompt).
 */
export function findSystemPromptDefault(defaults: Record<string, any>): string | undefined {
  if (typeof defaults.systemPrompt === "string") return defaults.systemPrompt;
  for (const val of Object.values(defaults)) {
    if (val && typeof val === "object" && typeof val.systemPrompt === "string") {
      return val.systemPrompt;
    }
  }
  return undefined;
}

/**
 * Inject the user-chosen model id into the defaults at the right path.
 * For flat schemas (simple): sets defaults.model = modelId
 * For nested schemas (sales): sets defaults.conversation.model = { modelId }
 */
export function injectModel(defaults: Record<string, any>, modelId: string): void {
  if (defaults.conversation && typeof defaults.conversation === "object") {
    defaults.conversation.model = { modelId };
  } else {
    defaults.model = modelId;
  }
}

/**
 * Inject the user-provided systemPrompt into the defaults at the right path.
 */
export function injectSystemPrompt(defaults: Record<string, any>, systemPrompt: string): void {
  if (defaults.conversation && typeof defaults.conversation === "object") {
    defaults.conversation.systemPrompt = systemPrompt;
  } else {
    defaults.systemPrompt = systemPrompt;
  }
}
