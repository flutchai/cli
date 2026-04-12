import { Command } from "commander";
import { registerUnifiedCommand } from "./register-unified";
import { listGraphsCommand } from "./list";
import { validateUnifiedCommand } from "./validate-unified";
import { createGraphCommand } from "./create";
import { addVersionCommand } from "./add-version";

export const graphCommands = new Command("graph")
  .description("Manage graphs")
  .addCommand(createGraphCommand)
  .addCommand(addVersionCommand)
  .addCommand(registerUnifiedCommand.name("register").alias("reg"))
  .addCommand(listGraphsCommand)
  .addCommand(validateUnifiedCommand.name("validate").alias("val"));
