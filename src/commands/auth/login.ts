import { Command } from "commander";
import chalk from "chalk";
import open from "open";
import ora from "ora";
import { createHash, randomBytes } from "crypto";
import { startOAuthServer } from "../../auth/oauth-server";
import { saveTokens, getUserFromToken, loadTokens } from "../../auth/token-storage";
import { getAuthConfig } from "../../config/auth-config";
import { getConfig } from "../../config/simple-config";

/** Tokens from our backend for the code the browser handed back. */
async function exchangeCliCode(
  apiUrl: string,
  siteName: string,
  code: string,
  codeVerifier: string,
  redirectUri: string
) {
  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/public/auth/cli/token`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-site-name": siteName },
    body: JSON.stringify({ code, codeVerifier, redirectUri }),
  });
  if (!res.ok) {
    throw new Error(`Sign-in was refused (HTTP ${res.status}). Try again.`);
  }
  return (await res.json()) as {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: { id: string; email: string };
  };
}

async function loginHandler(options: any, command: any) {
  const globalOpts = command.optsWithGlobals();
  const authConfig = getAuthConfig(globalOpts.config);
  const { apiUrl, siteName = "flutch" } = getConfig(globalOpts.config) as {
    apiUrl: string;
    siteName?: string;
  };

  let authUrlString: string;
  if (authConfig?.cliAuthUrl) {
    authUrlString = authConfig.cliAuthUrl;
  } else if (authConfig?.frontendUrl) {
    authUrlString = authConfig.frontendUrl.replace(/\/$/, "") + "/cli-auth";
  } else {
    authUrlString = "https://console.flutch.ai/cli-auth";
  }

  // PKCE: the browser only ever sees the challenge; the verifier stays here.
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  const { port, codePromise, server } = await startOAuthServer(state);
  const redirectUri = `http://localhost:${port}/callback`;
  const authUrl = new URL(authUrlString);
  authUrl.searchParams.append("redirect_uri", redirectUri);
  authUrl.searchParams.append("code_challenge", codeChallenge);
  authUrl.searchParams.append("state", state);

  await open(authUrl.toString());

  const spinner = ora("Waiting for browser…").start();

  try {
    const code = await codePromise;
    const result = await exchangeCliCode(apiUrl, siteName, code, codeVerifier, redirectUri);
    saveTokens({
      kind: "web",
      apiUrl,
      siteName,
      accessToken: result.accessToken,
      idToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: Date.now() + result.expiresIn * 1000,
    });
    spinner.succeed(`Logged in as ${chalk.cyan(result.user.email)}`);
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
