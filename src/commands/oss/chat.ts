import { Command } from "commander";
import chalk from "chalk";
import axios from "axios";
import * as crypto from "crypto";
import { readAgentsFile } from "../../oss/agents-file";

export const chatCommand = new Command("chat")
  .description("Send a message to an agent and stream the response")
  .argument("<agent-id>", "Agent ID from agents.json")
  .argument("<message>", "Message to send")
  .option("--engine <url>", "Engine base URL", "http://localhost:3000")
  .option("-f, --file <path>", "Path to agents.json", "agents.json")
  .option("--thread <id>", "Thread ID for conversation continuity")
  .option("--user <id>", "User ID", "cli")
  .addHelpText(
    "after",
    `
Examples:
  flutch chat assistant "Hello, how are you?"
  flutch chat sales-agent "I need help with my CRM" --thread my-thread-1
`
  )
  .action(
    async (
      agentId: string,
      message: string,
      options: { engine: string; file: string; thread?: string; user: string }
    ) => {
      let agents: Record<string, any>;
      try {
        agents = await readAgentsFile(options.file);
      } catch (err: any) {
        console.error(chalk.red("✗"), err.message);
        process.exit(1);
      }

      const agent = agents[agentId];
      if (!agent) {
        console.error(chalk.red(`✗ Agent "${agentId}" not found in agents.json`));
        console.log(chalk.dim(`  Available: ${Object.keys(agents).join(", ")}`));
        process.exit(1);
      }

      const threadId = options.thread ?? `${agentId}:${options.user}`;
      const requestId = crypto.randomUUID();

      const payload = {
        requestId,
        input: {
          messages: [{ type: "human", content: message }],
        },
        config: {
          configurable: {
            thread_id: threadId,
            context: {
              userId: options.user,
              agentId,
              threadId,
              platform: "cli",
            },
            graphSettings: agent.graphSettings ?? {},
          },
        },
      };

      process.stdout.write(chalk.dim(`${agentId}> `));

      try {
        const response = await axios.post(`${options.engine}/stream`, payload, {
          responseType: "stream",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          timeout: 60000,
        });

        let buffer = "";
        let printed = false;

        await new Promise<void>((resolve, reject) => {
          response.data.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";

            for (const raw of events) {
              if (!raw.trim()) continue;
              const lines = raw.split("\n");
              let eventType = "";
              let data = "";
              for (const line of lines) {
                if (line.startsWith("event: ")) eventType = line.slice(7).trim();
                if (line.startsWith("data: ")) data = line.slice(6).trim();
              }
              if (!data) continue;

              if (eventType === "stream_event") {
                try {
                  const parsed = JSON.parse(data);
                  const text =
                    parsed.text ?? parsed.content ?? (typeof parsed === "string" ? parsed : null);
                  if (text) {
                    process.stdout.write(text);
                    printed = true;
                  }
                } catch {
                  // raw string chunk
                  process.stdout.write(data);
                  printed = true;
                }
              } else if (eventType === "final") {
                try {
                  const parsed = JSON.parse(data);
                  if (!printed && parsed.text) {
                    process.stdout.write(parsed.text);
                  }
                } catch {
                  /* ignore */
                }
              } else if (eventType === "error") {
                try {
                  const parsed = JSON.parse(data);
                  process.stdout.write("\n");
                  console.error(chalk.red("✗"), parsed.message ?? data);
                } catch {
                  process.stdout.write("\n");
                  console.error(chalk.red("✗"), data);
                }
              }
            }
          });

          response.data.on("end", () => {
            process.stdout.write("\n");
            resolve();
          });
          response.data.on("error", reject);
        });
      } catch (err: any) {
        process.stdout.write("\n");
        if (err.code === "ECONNREFUSED") {
          console.error(
            chalk.red("✗ Engine not running."),
            "Start with:",
            chalk.cyan("flutch dev")
          );
        } else {
          console.error(chalk.red("✗"), err.response?.data?.message ?? err.message);
        }
        process.exit(1);
      }
    }
  );
