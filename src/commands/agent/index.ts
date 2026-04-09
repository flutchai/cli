import { Command } from "commander";
import { listAgentsCommand } from "./list";
import { addAgentCommand } from "./add";
import { editAgentCommand } from "./edit";
import { removeAgentCommand } from "./remove";

export const agentCommands = new Command("agent")
  .description("Manage agents in agents.json")
  .addCommand(listAgentsCommand)
  .addCommand(addAgentCommand)
  .addCommand(editAgentCommand)
  .addCommand(removeAgentCommand);
