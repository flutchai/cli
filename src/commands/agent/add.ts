import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import * as path from "path";
import {
  readAgentsFile,
  writeAgentsFile,
  MODEL_CHOICES,
  discoverGraphTypes,
} from "../../oss/agents-file";
import {
  findManifest,
  loadManifestSchema,
  extractSchemaDefaults,
  findSystemPromptDefault,
  injectModel,
  injectSystemPrompt,
} from "../../oss/manifest";

export const addAgentCommand = new Command("add")
  .description("Add a new agent to agents.json")
  .option("-f, --file <path>", "Path to agents.json", "agents.json")
  .action(async (options: { file: string }) => {
    let existing: Record<string, any> = {};
    try {
      existing = await readAgentsFile(options.file);
    } catch {
      // file doesn't exist yet — that's fine
    }

    console.log();

    const agentsDir = path.dirname(path.resolve(options.file));
    const graphTypeChoices = await discoverGraphTypes(agentsDir);

    const baseAnswers = await inquirer.prompt([
      {
        type: "input",
        name: "id",
        message: "Agent ID:",
        validate: (v: string) => {
          if (!/^[a-z0-9-]+$/.test(v.trim())) return "Use lowercase letters, numbers, hyphens";
          if (existing[v.trim()]) return `"${v.trim()}" already exists`;
          return true;
        },
        filter: (v: string) => v.trim(),
      },
      {
        type: "list",
        name: "graphType",
        message: "Agent type:",
        choices: graphTypeChoices,
      },
    ]);

    // Load manifest schema defaults for the selected graph type
    const manifestResult = await findManifest(baseAnswers.graphType, agentsDir);
    let graphSettings: Record<string, any> = {};

    if (manifestResult) {
      const schema = await loadManifestSchema(manifestResult.manifest, manifestResult.dir);
      if (schema) {
        graphSettings = extractSchemaDefaults(schema);
      }
    }

    const systemPromptDefault =
      findSystemPromptDefault(graphSettings) ?? "You are a helpful AI assistant.";

    const configAnswers = await inquirer.prompt([
      {
        type: "list",
        name: "model",
        message: "Model:",
        choices: MODEL_CHOICES,
      },
      {
        type: "input",
        name: "systemPrompt",
        message: "System prompt:",
        default: systemPromptDefault,
      },
      {
        type: "confirm",
        name: "addTelegram",
        message: "Add Telegram bot?",
        default: false,
      },
      {
        type: "input",
        name: "telegramToken",
        message: "Telegram bot token:",
        when: (ans: any) => ans.addTelegram,
        validate: (v: string) => v.length > 0 || "Required",
      },
    ]);

    injectModel(graphSettings, configAnswers.model);
    injectSystemPrompt(graphSettings, configAnswers.systemPrompt.trim());

    const entry: Record<string, any> = {
      graphType: baseAnswers.graphType,
      graphSettings,
    };
    if (configAnswers.addTelegram) {
      entry.platforms = { telegram: { botToken: configAnswers.telegramToken } };
    }

    const spinner = ora("Saving…").start();
    try {
      existing[baseAnswers.id] = entry;
      await writeAgentsFile(existing, options.file);
      spinner.succeed(`Agent ${chalk.cyan(baseAnswers.id)} added`);
    } catch (err: any) {
      spinner.fail(err.message);
      process.exit(1);
    }
    console.log();
  });
