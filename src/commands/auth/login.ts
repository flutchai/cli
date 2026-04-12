import { Command } from "commander";
import chalk from "chalk";
import open from "open";
import ora from "ora";
import { startOAuthServer, exchangeCodeForTokens } from "../../auth/oauth-server";
import { saveTokens, getUserFromToken, loadTokens } from "../../auth/token-storage";
import { getAuthConfig } from "../../config/auth-config";

async function loginHandler(options: any, command: any) {
  const globalOpts = command.optsWithGlobals();
  const authConfig = getAuthConfig(globalOpts.config);

  let authUrlString: string;
  if (authConfig?.cliAuthUrl) {
    authUrlString = authConfig.cliAuthUrl;
  } else if (authConfig?.frontendUrl) {
    authUrlString = authConfig.frontendUrl.replace(/\/$/, "") + "/cli-auth";
  } else {
    authUrlString = "https://console.flutch.ai/cli-auth";
  }

  const { port, codePromise, tokensPromise, server } = await startOAuthServer();
  const authUrl = new URL(authUrlString);
  authUrl.searchParams.append("redirect_uri", `http://localhost:${port}/callback`);

  await open(authUrl.toString());

  const spinner = ora("Waiting for browser…").start();

  try {
    const directTokens = await tokensPromise;

    let tokens;
    if (directTokens) {
      tokens = directTokens;
    } else {
      if (!authConfig) {
        throw new Error("Auth config not found. Check the auth section in ~/.flutch/config.json");
      }
      const code = await codePromise;
      tokens = await exchangeCodeForTokens(code, `http://localhost:${port}/callback`, {
        domain: authConfig.cognitoDomain,
        clientId: authConfig.cognitoClientId,
        region: authConfig.cognitoRegion,
      });
    }

    saveTokens(tokens);
    const user = getUserFromToken(tokens.idToken);
    spinner.succeed(user?.email ? `Logged in as ${chalk.cyan(user.email)}` : "Logged in");
  } catch (err: any) {
    spinner.fail("Authentication failed");
    console.error(chalk.red(err?.message ?? err));
    process.exit(1);
  } finally {
    server.close();
  }
}

async function logoutHandler() {
  const { clearTokens } = await import("../../auth/token-storage");
  clearTokens();
  console.log(chalk.green("✓ Logged out"));
}

async function whoamiHandler() {
  const tokens = loadTokens();
  if (!tokens) {
    console.log(chalk.dim("Not logged in. Run"), chalk.cyan("flutch login"));
    return;
  }
  const user = getUserFromToken(tokens.idToken);
  if (user?.email) {
    console.log(chalk.green("✓"), user.email);
  } else {
    console.log(chalk.yellow("Could not read user info from token"));
  }
}

export const loginCommand = new Command("login")
  .description("Authenticate with Flutch")
  .action(loginHandler);

export const logoutCommand = new Command("logout")
  .description("Log out and clear stored credentials")
  .action(logoutHandler);

export const whoamiCommand = new Command("whoami")
  .description("Show current authenticated user")
  .action(whoamiHandler);
