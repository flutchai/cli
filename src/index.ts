#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { graphCommands } from "./commands/graph";
import { configCommand, whoamiCommand } from "./commands/config";
import { loginCommand, logoutCommand } from "./commands/auth";
import { initCommand } from "./commands/init";
import { agentCommands } from "./commands/agent";
import { statusCommand } from "./commands/oss/status";
import { chatCommand } from "./commands/oss/chat";
import { devCommand, startCommand, stopCommand, logsCommand } from "./commands/oss/compose";

const program = new Command();

program
  .name("flutch")
  .description("Manage Flutch agents — self-hosted (OSS) or on the platform")
  .version("0.0.1")
  .option("-c, --config <path>", "Path to config file (default: ~/.flutch/config.json)")
  .option("-e, --environment <env>", "Environment to use (overrides config file)");

// ── OSS — work locally, no login required ────────────────────────────────────
program.addCommand(initCommand);
program.addCommand(agentCommands);
program.addCommand(chatCommand);
program.addCommand(statusCommand);
program.addCommand(devCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);
program.addCommand(logsCommand);

// ── Platform — require login + API key ───────────────────────────────────────
program.addCommand(graphCommands);
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(configCommand);
program.addCommand(whoamiCommand);

try {
  program.parse();
} catch (error) {
  if (error instanceof Error && !error.message.includes("outputHelp")) {
    console.error(chalk.red("\n✗ Error:"), error.message);
    process.exit(1);
  }
}
