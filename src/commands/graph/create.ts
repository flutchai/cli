import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import { promises as fs } from "fs";
import * as path from "path";

export const createGraphCommand = new Command("create")
  .description("Add a new graph to an existing Flutch project")
  .action(async () => {
    // Verify we're inside a Flutch project
    const cwd = process.cwd();
    const appModulePath = path.join(cwd, "src", "app.module.ts");
    const graphIndexPath = path.join(cwd, "src", "graph", "index.ts");

    try {
      await fs.access(appModulePath);
    } catch {
      console.error(
        chalk.red("✗ Not a Flutch project."),
        "Run this command from the project root (where src/app.module.ts lives)."
      );
      process.exit(1);
    }

    // Detect company slug from existing manifests
    let companySlug = "custom";
    try {
      const files = (await fs.readdir(cwd)).filter(f => /^graph\.manifest\..+\.json$/.test(f));
      if (files.length > 0) {
        const first = JSON.parse(await fs.readFile(path.join(cwd, files[0]), "utf-8"));
        if (first.companySlug) companySlug = first.companySlug;
      }
    } catch {
      /* use default */
    }

    console.log();

    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Graph name (kebab-case):",
        validate: (v: string) => {
          if (!/^[a-z][a-z0-9-]*$/.test(v.trim())) return "Use kebab-case (lowercase, hyphens)";
          return true;
        },
        filter: (v: string) => v.trim(),
      },
      {
        type: "input",
        name: "title",
        message: "Title:",
        validate: (v: string) => v.trim().length >= 3 || "At least 3 characters",
        filter: (v: string) => v.trim(),
      },
      {
        type: "input",
        name: "description",
        message: "Description:",
        validate: (v: string) => v.trim().length >= 5 || "At least 5 characters",
        filter: (v: string) => v.trim(),
      },
      {
        type: "input",
        name: "version",
        message: "Initial version:",
        default: "1.0.0",
        validate: (v: string) => /^\d+\.\d+\.\d+$/.test(v) || "Use semver (e.g. 1.0.0)",
      },
    ]);

    const { name, title, description, version } = answers;
    const graphType = `${companySlug}.${name}`;
    const className = toPascalCase(name);
    const graphDir = path.join(cwd, "src", "graph", name);

    const spinner = ora("Creating graph…").start();

    try {
      await fs.mkdir(graphDir, { recursive: true });

      await Promise.all([
        fs.writeFile(
          path.join(graphDir, "builder.ts"),
          builderTemplate(className, graphType, version)
        ),
        fs.writeFile(path.join(graphDir, "config-schema.json"), configSchemaTemplate(title)),
        fs.writeFile(
          path.join(cwd, `graph.manifest.${name}.json`),
          manifestTemplate(name, companySlug, title, description, version)
        ),
      ]);

      // Append export to src/graph/index.ts
      try {
        let indexContent = await fs.readFile(graphIndexPath, "utf-8").catch(() => "");
        const exportLine = `export { ${className}Builder } from "./${name}/builder";\n`;
        if (!indexContent.includes(exportLine.trim())) {
          indexContent += exportLine;
          await fs.writeFile(graphIndexPath, indexContent, "utf-8");
        }
      } catch {
        /* index.ts optional */
      }

      spinner.succeed(`Graph "${chalk.cyan(name)}" created`);
    } catch (err: any) {
      spinner.fail(err.message);
      process.exit(1);
    }

    console.log();
    console.log(chalk.bold("Created:"));
    console.log(chalk.dim(`  src/graph/${name}/builder.ts`));
    console.log(chalk.dim(`  src/graph/${name}/config-schema.json`));
    console.log(chalk.dim(`  graph.manifest.${name}.json`));
    console.log();
    console.log(chalk.bold("Add to src/app.module.ts:"));
    console.log();
    console.log(chalk.dim(`  // 1. Import the builder`));
    console.log(`  import { ${className}Builder } from "./graph/${name}/builder";`);
    console.log();
    console.log(chalk.dim(`  // 2. Add to UniversalGraphModule.forRoot() versioning array`));
    console.log(`  {`);
    console.log(`    baseGraphType: "${graphType}",`);
    console.log(
      `    versions: [{ version: "${version}", builderClass: ${className}Builder, isDefault: true }],`
    );
    console.log(`  },`);
    console.log();
    console.log(chalk.dim(`  // 3. Add to providers array`));
    console.log(`  ${className}Builder,`);
    console.log();
    console.log(chalk.dim(`  // 4. Inject in onModuleInit and register`));
    console.log(`  this.builderRegistry.registerBuilder(this.${camelCase(name)}Builder);`);
    console.log();
    console.log(
      `Then run: ${chalk.cyan("flutch agent add")} to register "${chalk.cyan(graphType)}" in agents.json`
    );
    console.log();
  });

function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function camelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function builderTemplate(className: string, graphType: string, version: string): string {
  return `import { Injectable, Optional, Inject, Logger } from "@nestjs/common";
import {
  AbstractGraphBuilder,
  IGraphRequestPayload,
  McpRuntimeHttpClient,
  IGraphAttachment,
  executeToolWithAttachments,
} from "@flutchai/flutch-sdk";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { AIMessage, BaseMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { createModel } from "../model.factory";
import { CHECKPOINTER } from "../../modules/checkpointer/checkpointer.service";

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  attachments: Annotation<Record<string, IGraphAttachment>>({
    reducer: (_x, y) => ({ ..._x, ...y }),
    default: () => ({}),
  }),
});

/**
 * ${className} graph — LLM with optional MCP tools.
 * graphType: ${graphType}::${version}
 */
@Injectable()
export class ${className}Builder extends AbstractGraphBuilder<"${version}"> {
  readonly version = "${version}" as const;
  protected readonly logger = new Logger(${className}Builder.name);

  constructor(
    @Optional() @Inject(CHECKPOINTER) private readonly checkpointer: any,
    private readonly mcpClient: McpRuntimeHttpClient,
  ) {
    super();
  }

  get graphType(): string {
    return "${graphType}::${version}";
  }

  async buildGraph(payload?: IGraphRequestPayload): Promise<any> {
    const graphSettings = payload?.config?.configurable?.graphSettings ?? {};
    const systemPrompt: string | undefined = graphSettings.systemPrompt;
    const modelConfig = graphSettings.model ?? {};
    const model = createModel({
      model: modelConfig.modelName ?? "gpt-4o-mini",
      provider: modelConfig.provider,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    });

    // ── Tool binding ─────────────────────────────────────────────────────────
    const toolsDef = (modelConfig.tools ?? [])
      .map((t: any) => (typeof t === "string" ? { name: t, enabled: true } : t))
      .filter((t: any) => t.enabled !== false);

    let boundModel: any = model;
    const toolConfigs: Record<string, any> = {};

    if (toolsDef.length > 0) {
      try {
        const mcpTools = await this.mcpClient.getTools();
        const enabled = new Set(toolsDef.map((t: any) => t.name));
        const filtered = mcpTools.filter((t: any) => enabled.has(t.name));
        if (filtered.length > 0) {
          boundModel = (model as any).bindTools(filtered);
          this.logger.debug(\`Bound \${filtered.length} tools\`);
        }
      } catch (err: any) {
        this.logger.warn(\`Tool binding failed: \${err.message}\`);
      }
      for (const t of toolsDef) {
        if (t.config) toolConfigs[t.name] = t.config;
      }
    }

    const ctx = payload?.config?.configurable;
    const mcpClient = this.mcpClient;

    // ── Nodes ────────────────────────────────────────────────────────────────
    const generateNode = async (state: typeof AgentState.State) => {
      const messages: BaseMessage[] = [];
      if (systemPrompt) messages.push(new SystemMessage(systemPrompt));
      messages.push(...state.messages);
      const response = (await boundModel.invoke(messages)) as AIMessage;
      return { messages: [response] };
    };

    const execToolsNode = async (state: typeof AgentState.State, config: any) => {
      const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
      const toolCalls = lastMessage?.tool_calls ?? [];
      if (toolCalls.length === 0) return {};

      const context = (config?.configurable as any)?.context ?? ctx?.context ?? {};
      const executionContext: Record<string, any> = {};
      if (context.userId) executionContext.userId = context.userId;
      if (context.agentId) executionContext.agentId = context.agentId;
      if (context.threadId || config?.configurable?.thread_id) {
        executionContext.threadId = context.threadId || config.configurable.thread_id;
      }

      const toolMessages: ToolMessage[] = [];
      const newAttachments: Record<string, IGraphAttachment> = {};

      for (const toolCall of toolCalls) {
        try {
          const enrichedArgs = { ...(toolConfigs[toolCall.name] ?? {}), ...(toolCall.args ?? {}) };
          const result = await executeToolWithAttachments({
            toolCall: { id: toolCall.id ?? toolCall.name, name: toolCall.name, args: toolCall.args ?? {} },
            mcpClient,
            enrichedArgs,
            executionContext: { ...(toolConfigs[toolCall.name] ?? {}), ...executionContext },
            config,
            attachments: { ...state.attachments, ...newAttachments },
            logger: this.logger,
          });
          toolMessages.push(result.toolMessage);
          if (result.attachment) newAttachments[result.attachment.key] = result.attachment.value;
        } catch (err: any) {
          toolMessages.push(new ToolMessage({
            content: JSON.stringify({ error: err.message, tool: toolCall.name }),
            tool_call_id: toolCall.id ?? toolCall.name,
            name: toolCall.name,
          }));
        }
      }

      return {
        messages: toolMessages,
        ...(Object.keys(newAttachments).length ? { attachments: newAttachments } : {}),
      };
    };

    // ── Graph ────────────────────────────────────────────────────────────────
    const workflow = new StateGraph(AgentState)
      .addNode("generate", generateNode)
      .addNode("exec_tools", execToolsNode);

    workflow.addEdge(START, "generate");
    workflow.addConditionalEdges("generate",
      (state) => {
        const last = state.messages[state.messages.length - 1] as AIMessage;
        return (last?.tool_calls?.length ?? 0) > 0 ? "exec_tools" : "__end__";
      },
      { exec_tools: "exec_tools", __end__: END }
    );
    workflow.addEdge("exec_tools", "generate");

    return workflow.compile({ checkpointer: this.checkpointer ?? undefined });
  }
}
`;
}

function configSchemaTemplate(title: string): string {
  return (
    JSON.stringify(
      {
        type: "object",
        properties: {
          systemPrompt: {
            type: "string",
            title: "System Prompt",
            format: "textarea",
            default: "You are a helpful AI assistant.",
          },
          model: {
            type: "modelConfig",
            title: "Model",
            params: {
              modelType: "chat",
              isActive: true,
              showTemperature: true,
              showMaxTokens: true,
              showTools: true,
            },
          },
        },
        required: ["systemPrompt"],
      },
      null,
      2
    ) + "\n"
  );
}

function manifestTemplate(
  name: string,
  companySlug: string,
  title: string,
  description: string,
  version: string
): string {
  return (
    JSON.stringify(
      {
        name,
        companySlug,
        title,
        description,
        category: "agent",
        author: "",
        tags: [name],
        visibility: "public",
        versioning: {
          strategy: "semver",
          defaultVersion: version,
          supportedVersions: [version],
        },
        versions: {
          [version]: {
            status: "development",
            isActive: true,
            configSchemaPath: `./src/graph/${name}/config-schema.json`,
          },
        },
      },
      null,
      2
    ) + "\n"
  );
}
