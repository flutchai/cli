import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { promises as fs } from "fs";
import * as path from "path";
import {
  dockerCompose,
  dotenv,
  agentsJson,
  mcpServersJson,
  gitignore,
  generateSecrets,
  InitConfig,
} from "../oss/templates";

export const initCommand = new Command("init")
  .description("Scaffold a new self-hosted Flutch agent project")
  .argument("[name]", "Project directory name")
  .addHelpText(
    "after",
    `
Examples:
  flutch init
  flutch init my-agents
`
  )
  .action(async (nameArg: string | undefined) => {
    console.log();
    console.log(chalk.bold("  Flutch OSS — New Project"));
    console.log();

    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "projectName",
        message: "Project name:",
        default: nameArg ?? "my-agents",
        when: !nameArg,
        validate: (v: string) =>
          /^[a-z0-9-_]+$/i.test(v.trim()) || "Use letters, numbers, hyphens, underscores",
        filter: (v: string) => v.trim(),
      },
      {
        type: "input",
        name: "agentName",
        message: "Agent name:",
        default: "assistant",
        filter: (v: string) => v.trim().toLowerCase().replace(/\s+/g, "-"),
      },
      {
        type: "input",
        name: "agentDescription",
        message: "System prompt:",
        default: "You are a helpful AI assistant.",
      },
      {
        type: "list",
        name: "llmProvider",
        message: "LLM provider:",
        choices: [
          { name: "OpenAI  (gpt-4o-mini)", value: "openai" },
          { name: "Anthropic  (claude-3-5-haiku)", value: "anthropic" },
        ],
      },
      {
        type: "password",
        name: "openaiKey",
        message: "OpenAI API key:",
        mask: "*",
        when: (ans: any) => ans.llmProvider === "openai",
        validate: (v: string) => v.startsWith("sk-") || "Should start with sk-",
      },
      {
        type: "password",
        name: "anthropicKey",
        message: "Anthropic API key:",
        mask: "*",
        when: (ans: any) => ans.llmProvider === "anthropic",
        validate: (v: string) => v.startsWith("sk-ant-") || "Should start with sk-ant-",
      },
      {
        type: "confirm",
        name: "enableWebSearch",
        message: "Enable web search? (requires Tavily API key)",
        default: false,
      },
      {
        type: "password",
        name: "tavilyKey",
        message: "Tavily API key:",
        mask: "*",
        when: (ans: any) => ans.enableWebSearch,
        validate: (v: string) => v.startsWith("tvly-") || "Should start with tvly-",
      },
      {
        type: "number",
        name: "port",
        message: "Port:",
        default: 3000,
      },
    ]);

    const cfg: InitConfig = {
      projectName: nameArg ?? answers.projectName,
      agentName: answers.agentName,
      agentDescription: answers.agentDescription,
      openaiKey: answers.openaiKey,
      anthropicKey: answers.anthropicKey,
      port: answers.port ?? 3000,
      enableWebSearch: answers.enableWebSearch ?? false,
      tavilyKey: answers.tavilyKey,
      ...generateSecrets(),
    };

    const dir = path.resolve(cfg.projectName);
    const spinner = ora(`Creating ${chalk.cyan(cfg.projectName)}/`).start();

    try {
      await fs.mkdir(dir, { recursive: true });

      const files: Array<[string, string]> = [
        ["docker-compose.yml", dockerCompose(cfg)],
        [".env", dotenv(cfg)],
        ["agents.json", agentsJson(cfg)],
        ["mcp-servers.json", mcpServersJson(cfg)],
        [".gitignore", gitignore()],
      ];

      for (const [name, content] of files) {
        await fs.writeFile(path.join(dir, name), content, "utf-8");
      }

      spinner.succeed(`Created ${chalk.cyan(cfg.projectName)}/`);
    } catch (err: any) {
      spinner.fail("Failed to create project");
      console.error(chalk.red(err?.message ?? err));
      process.exit(1);
    }

    console.log();
    console.log(`  ${chalk.dim("cd")} ${cfg.projectName}`);
    console.log(`  ${chalk.cyan("docker compose up")}`);
    console.log();
    console.log(`  ${chalk.dim("Agent   →")} http://localhost:${cfg.port}/generate`);
    console.log(`  ${chalk.dim("Admin   →")} http://localhost:${cfg.port}/admin`);
    console.log(`  ${chalk.dim("Password→")} ${chalk.yellow(cfg.adminPassword)}`);
    console.log();
  });
