import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import { readAgentsFile, writeAgentsFile, MODEL_CHOICES } from "../../oss/agents-file";

export const editAgentCommand = new Command("edit")
  .description("Edit an agent in agents.json")
  .argument("[id]", "Agent ID")
  .option("-f, --file <path>", "Path to agents.json", "agents.json")
  .action(async (idArg: string | undefined, options: { file: string }) => {
    let agents: Record<string, any>;
    try {
      agents = await readAgentsFile(options.file);
    } catch (err: any) {
      console.error(chalk.red("✗"), err.message);
      process.exit(1);
    }

    const ids = Object.keys(agents);
    if (ids.length === 0) {
      console.log(chalk.dim("No agents found. Run `flutch agent add` first."));
      return;
    }

    console.log();

    let id = idArg;
    if (!id) {
      ({ id } = await inquirer.prompt([
        { type: "list", name: "id", message: "Agent:", choices: ids },
      ]));
    }

    if (!agents[id!]) {
      console.error(chalk.red(`✗ Agent "${id}" not found`));
      process.exit(1);
    }

    const s = agents[id!].graphSettings ?? {};

    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "model",
        message: "Model:",
        choices: MODEL_CHOICES,
        default: s.model ?? s.conversation?.model?.modelId,
      },
      {
        type: "input",
        name: "systemPrompt",
        message: "System prompt:",
        default: s.systemPrompt ?? "",
      },
    ]);

    const spinner = ora("Saving…").start();
    try {
      agents[id!] = {
        ...agents[id!],
        graphSettings: { ...s, model: answers.model, systemPrompt: answers.systemPrompt.trim() },
      };
      await writeAgentsFile(agents, options.file);
      spinner.succeed(`Agent ${chalk.cyan(id)} updated`);
    } catch (err: any) {
      spinner.fail(err.message);
      process.exit(1);
    }
    console.log();
  });
