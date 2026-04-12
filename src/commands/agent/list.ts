import { Command } from "commander";
import chalk from "chalk";
import Table from "cli-table3";
import { readAgentsFile } from "../../oss/agents-file";

export const listAgentsCommand = new Command("list")
  .alias("ls")
  .description("List agents defined in agents.json")
  .option("-f, --file <path>", "Path to agents.json", "agents.json")
  .action(async (options: { file: string }) => {
    let agents: Record<string, any>;
    try {
      agents = await readAgentsFile(options.file);
    } catch (err: any) {
      console.error(chalk.red("✗"), err.message);
      process.exit(1);
    }

    const ids = Object.keys(agents);
    if (ids.length === 0) {
      console.log(chalk.dim("No agents. Run `flutch agent add` to create one."));
      return;
    }

    const table = new Table({
      head: [chalk.cyan("id"), chalk.cyan("type"), chalk.cyan("model")],
      colWidths: [24, 18, 30],
    });

    for (const id of ids) {
      const s = agents[id].graphSettings ?? {};
      const model = s.model ?? s.conversation?.model?.modelId ?? s.llm?.modelId ?? chalk.dim("—");
      table.push([id, agents[id].graphType ?? chalk.dim("—"), model]);
    }

    console.log();
    console.log(table.toString());
    console.log(chalk.dim(`\n  ${ids.length} agent(s) · ${options.file}`));
    console.log();
  });
