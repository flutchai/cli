import { promises as fs } from "fs";
import * as path from "path";

export function resolveAgentsPath(filePath?: string): string {
  return path.resolve(filePath ?? "agents.json");
}

export async function readAgentsFile(filePath?: string): Promise<Record<string, any>> {
  const resolved = resolveAgentsPath(filePath);
  try {
    const raw = await fs.readFile(resolved, "utf-8");
    return JSON.parse(raw);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(
        `agents.json not found at ${resolved}.\n` +
          `  Run \`flutch init\` to scaffold a new project.`
      );
    }
    throw new Error(`Failed to read ${resolved}: ${err.message}`);
  }
}

export async function writeAgentsFile(
  agents: Record<string, any>,
  filePath?: string
): Promise<void> {
  const resolved = resolveAgentsPath(filePath);
  await fs.writeFile(resolved, JSON.stringify(agents, null, 2) + "\n", "utf-8");
}

export const GRAPH_TYPES = [
  { name: "flutch.simple  — chat with optional tools", value: "flutch.simple" },
  { name: "flutch.sales   — CRM-driven lead qualification", value: "flutch.sales" },
];

/**
 * Discover graph types from graph.manifest.*.json files in agentsDir.
 * Falls back to hardcoded GRAPH_TYPES if no manifests are found.
 */
export async function discoverGraphTypes(
  agentsDir: string
): Promise<Array<{ name: string; value: string }>> {
  try {
    const files = (await fs.readdir(agentsDir)).filter(f => /^graph\.manifest\..+\.json$/.test(f));

    if (files.length === 0) return GRAPH_TYPES;

    const choices: Array<{ name: string; value: string }> = [];
    for (const file of files.sort()) {
      try {
        const raw = await fs.readFile(path.join(agentsDir, file), "utf-8");
        const manifest = JSON.parse(raw);
        const companySlug = manifest.companySlug ?? "custom";
        const graphType = `${companySlug}.${manifest.name}`;
        const padded = graphType.padEnd(18);
        choices.push({
          name: `${padded}  ${manifest.description ?? manifest.title ?? ""}`,
          value: graphType,
        });
      } catch {
        // skip malformed manifests
      }
    }

    return choices.length > 0 ? choices : GRAPH_TYPES;
  } catch {
    return GRAPH_TYPES;
  }
}

export const MODEL_CHOICES = [
  { name: "gpt-4o-mini        (OpenAI, fast + cheap)", value: "gpt-4o-mini" },
  { name: "gpt-4o             (OpenAI, best quality)", value: "gpt-4o" },
  { name: "claude-3-5-haiku   (Anthropic, fast)", value: "claude-3-5-haiku-20241022" },
  { name: "claude-3-5-sonnet  (Anthropic, best quality)", value: "claude-3-5-sonnet-20241022" },
];
