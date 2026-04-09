import { Command } from "commander";
import chalk from "chalk";
import axios from "axios";
import { readAgentsFile } from "../../oss/agents-file";

async function ping(url: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await axios.get(url, { timeout: 3000 });
    return { ok: res.status < 400 };
  } catch (err: any) {
    return { ok: false, detail: err.code === "ECONNREFUSED" ? "not running" : "timeout" };
  }
}

export const statusCommand = new Command("status")
  .description("Check health of the local Flutch stack")
  .option("--engine <url>", "Engine base URL", "http://localhost:3000")
  .option("--mcp <url>", "MCP Runtime base URL", "http://localhost:3004")
  .option("-f, --file <path>", "Path to agents.json", "agents.json")
  .action(async (options: { engine: string; mcp: string; file: string }) => {
    console.log();

    const checks = [
      { name: "Engine", url: `${options.engine}/health` },
      { name: "MCP Runtime", url: `${options.mcp}/health` },
    ];

    for (const { name, url } of checks) {
      const { ok, detail } = await ping(url);
      const icon = ok ? chalk.green("●") : chalk.red("●");
      const label = ok ? chalk.green("ok") : chalk.red(detail ?? "down");
      console.log(`  ${icon}  ${name.padEnd(14)} ${label}`);
    }

    // Registered graph types from engine
    let registeredTypes: string[] = [];
    try {
      const { data } = await axios.get(`${options.engine}/registry`, { timeout: 3000 });
      if (Array.isArray(data.graphs) && data.graphs.length) {
        registeredTypes = data.graphs.map((g: any) => g.graphType as string);
        console.log(chalk.dim(`\n  Graphs:  ${registeredTypes.join(", ")}`));
      }
    } catch {
      /* non-critical */
    }

    // MCP tools list
    try {
      const { data } = await axios.get(`${options.mcp}/tools/list`, { timeout: 3000 });
      const tools: any[] = Array.isArray(data) ? data : [];
      if (tools.length) {
        console.log(chalk.dim(`  Tools:   ${tools.map(t => t.name).join(", ")}`));
      }
    } catch {
      /* non-critical */
    }

    // Agents from agents.json — cross-referenced with registered types
    try {
      const agents = await readAgentsFile(options.file);
      const ids = Object.keys(agents);
      if (ids.length) {
        console.log(chalk.dim(`\n  Agents:  ${ids.join(", ")}`));

        // Warn about unknown graph types
        if (registeredTypes.length > 0) {
          for (const [id, cfg] of Object.entries(agents) as [string, any][]) {
            const gt: string = cfg.graphType ?? "";
            const baseType = gt.split("::")[0];
            const known = registeredTypes.some(
              rt => rt === gt || rt.startsWith(baseType) || rt.includes(`.${gt.split(".")[1]}`)
            );
            if (!known) {
              console.log(chalk.yellow(`  ⚠ "${id}" uses "${gt}" — not registered in engine`));
            }
          }
        }
      }
    } catch {
      console.log(chalk.dim(`\n  agents.json not found — run \`flutch init\``));
    }

    console.log();
  });
