import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import { readAgentsFile, writeAgentsFile } from "../../oss/agents-file";

export const removeAgentCommand = new Command("remove")
  .alias("rm")
  .description("Remove an agent from agents.json")
  .argument("[id]", "Agent ID")
  .option("-f, --file <path>", "Path to agents.json", "agents.json")
  .option("-y, --yes", "Skip confirmation")
  .action(async (idArg: string | undefined, options: { file: string; yes?: boolean }) => {
    let agents: Record<string, any>;
    try {
      agents = await readAgentsFile(options.file);
    } catch (err: any) {
      console.error(chalk.red("✗"), err.message);
      process.exit(1);
    }

    const ids = Object.keys(agents);
    if (ids.length === 0) {
      console.log(chalk.dim("No agents found."));
      return;
    }

    console.log();

    let id = idArg;
    if (!id) {
      ({ id } = await inquirer.prompt([
        { type: "list", name: "id", message: "Remove which agent?", choices: ids },
      ]));
    }

    if (!agents[id!]) {
      console.error(chalk.red(`✗ Agent "${id}" not found`));
      process.exit(1);
    }

    if (!options.yes) {
      const { ok } = await inquirer.prompt([
        {
          type: "confirm",
          name: "ok",
          message: `Remove ${chalk.red(id)}?`,
          default: false,
        },
      ]);
      if (!ok) {
        console.log(chalk.dim("Aborted."));
        return;
      }
    }

    const spinner = ora("Saving…").start();
    try {
      delete agents[id!];
      await writeAgentsFile(agents, options.file);
      spinner.succeed(`Agent ${chalk.cyan(id)} removed`);
    } catch (err: any) {
      spinner.fail(err.message);
      process.exit(1);
    }
    console.log();
  });
