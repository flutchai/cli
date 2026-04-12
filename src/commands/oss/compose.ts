import { Command } from "commander";
import chalk from "chalk";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import * as path from "path";

async function hasComposeFile(): Promise<boolean> {
  for (const name of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
    try {
      await fs.access(path.join(process.cwd(), name));
      return true;
    } catch {
      /* not found */
    }
  }
  return false;
}

function compose(args: string[], opts: { inherit?: boolean } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", ...args], {
      stdio: opts.inherit !== false ? "inherit" : "pipe",
      cwd: process.cwd(),
    });
    child.on("exit", code => resolve(code ?? 0));
    child.on("error", err => {
      if ((err as any).code === "ENOENT") {
        reject(
          new Error("docker not found. Install Docker Desktop: https://docs.docker.com/get-docker/")
        );
      } else {
        reject(err);
      }
    });
  });
}

async function requireCompose(): Promise<void> {
  if (!(await hasComposeFile())) {
    console.error(
      chalk.red("✗ No docker-compose.yml found."),
      "Run",
      chalk.cyan("flutch init"),
      "first."
    );
    process.exit(1);
  }
}

export const devCommand = new Command("dev")
  .description("Start the stack in the background and follow logs")
  .option("--build", "Rebuild images before starting")
  .action(async (options: { build?: boolean }) => {
    await requireCompose();
    const upArgs = ["up", "-d"];
    if (options.build) upArgs.push("--build");

    console.log(chalk.dim("Starting stack…"));
    const code = await compose(upArgs).catch(err => {
      console.error(chalk.red("✗"), err.message);
      process.exit(1);
    });
    if (code !== 0) process.exit(code as number);

    console.log(chalk.dim("Following logs (Ctrl+C to detach)…\n"));
    await compose(["logs", "-f"]);
  });

export const startCommand = new Command("start")
  .description("Start the stack in the background")
  .option("--build", "Rebuild images before starting")
  .action(async (options: { build?: boolean }) => {
    await requireCompose();
    const upArgs = ["up", "-d"];
    if (options.build) upArgs.push("--build");

    console.log(chalk.dim("Starting stack…"));
    const code = await compose(upArgs).catch(err => {
      console.error(chalk.red("✗"), err.message);
      process.exit(1);
    });
    if (code !== 0) process.exit(code as number);
    console.log(chalk.green("✓ Stack started"));
    console.log(chalk.dim("  Run `flutch status` to verify health"));
  });

export const stopCommand = new Command("stop").description("Stop the stack").action(async () => {
  await requireCompose();
  console.log(chalk.dim("Stopping stack…"));
  await compose(["down"]).catch(err => {
    console.error(chalk.red("✗"), err.message);
    process.exit(1);
  });
  console.log(chalk.green("✓ Stack stopped"));
});

export const logsCommand = new Command("logs")
  .description("Follow logs from the stack or a specific service")
  .argument("[service]", "Service to tail: engine | mcp-runtime | postgres")
  .option("-n, --tail <lines>", "Number of recent lines to show", "50")
  .action(async (service: string | undefined, options: { tail: string }) => {
    await requireCompose();
    const args = ["logs", "-f", "--tail", options.tail];
    if (service) args.push(service);
    await compose(args).catch(err => {
      console.error(chalk.red("✗"), err.message);
      process.exit(1);
    });
  });
