import { Command } from "commander";
import chalk from "chalk";
import open from "open";
import ora from "ora";
import {
  startOAuthServer,
  exchangeCodeForTokens,
} from "../../auth/oauth-server";
import {
  saveTokens,
  getUserFromToken,
  loadTokens,
} from "../../auth/token-storage";
import { getAuthConfig } from "../../config/auth-config";

interface CognitoConfig {
  domain: string;
  clientId: string;
  region: string;
  frontendUrl: string;
}

/**
 * Get Cognito configuration from config files or environment
 * Only needed for legacy OAuth flow (not used with direct token flow)
 */
function getCognitoConfig(configFile?: string): CognitoConfig | null {
  const config = getAuthConfig(configFile);

  if (!config) {
    return null;
  }

  return {
    domain: config.cognitoDomain,
    clientId: config.cognitoClientId,
    region: config.cognitoRegion,
    frontendUrl: config.frontendUrl,
  };
}

/**
 * Login command handler
 */
async function loginHandler(options: any, command: any) {
  // Get global options including -c from parent
  const globalOpts = command.optsWithGlobals();
  const configFile = globalOpts.config;

  console.log(chalk.blue("🔐 Starting Flutch CLI authentication...\n"));
  console.log(chalk.dim(`Config file: ${configFile || 'default'}`));

  const authConfig = getAuthConfig(configFile);
  const cognitoConfig = getCognitoConfig(configFile);

  try {
    // Start local OAuth callback server
    const { port, codePromise, tokensPromise, server } = await startOAuthServer();

    const redirectUri = `http://localhost:${port}/callback`;

    // Build authorization URL
    // Priority: 1) cliAuthUrl from config, 2) frontendUrl + /cli-auth, 3) default production URL
    let authUrlString: string;
    if (authConfig?.cliAuthUrl) {
      authUrlString = authConfig.cliAuthUrl;
    } else if (authConfig?.frontendUrl) {
      const baseUrl = authConfig.frontendUrl.replace(/\/$/, ''); // Remove trailing slash
      authUrlString = `${baseUrl}/cli-auth`;
    } else {
      // Default to production console
      authUrlString = 'https://console.flutch.ai/cli-auth';
    }

    const authUrl = new URL(authUrlString);
    authUrl.searchParams.append("redirect_uri", redirectUri);

    console.log(chalk.dim("Opening browser for authentication..."));
    console.log(chalk.dim(`Authorization URL: ${authUrl.toString()}\n`));

    // Open browser
    await open(authUrl.toString());

    console.log(
      chalk.yellow(
        "⏳ Waiting for authorization... (This will timeout in 5 minutes)"
      )
    );
    console.log(
      chalk.dim(
        "   If browser doesn't open, copy the URL above and paste it in your browser.\n"
      )
    );

    const spinner = ora("Waiting for authorization...").start();

    try {
      // Wait for tokens (direct flow) or authorization code (OAuth flow)
      const directTokens = await tokensPromise;

      let tokens;
      if (directTokens) {
        // Direct token flow - tokens received directly from frontend
        spinner.text = "Saving tokens...";
        tokens = directTokens;
      } else {
        // OAuth flow - exchange code for tokens
        if (!cognitoConfig) {
          throw new Error("Cognito configuration required for OAuth flow. Please configure auth section in config file.");
        }
        const code = await codePromise;
        spinner.text = "Exchanging code for tokens...";
        tokens = await exchangeCodeForTokens(code, redirectUri, cognitoConfig);
      }

      saveTokens(tokens);
      spinner.succeed("Authentication successful!");

      // Decode and display user info
      const userInfo = getUserFromToken(tokens.idToken);
      if (userInfo) {
        console.log(chalk.green("\n✓ Logged in as:"), userInfo.email);
      }

      console.log(
        chalk.dim(
          `\nTokens saved to: ${require("os").homedir()}/.flutch/credentials.json`
        )
      );
      console.log(
        chalk.dim("Your session will be automatically refreshed when needed.\n")
      );
    } catch (error: any) {
      spinner.fail("Authentication failed");
      throw error;
    } finally {
      server.close();
    }
  } catch (error: any) {
    console.error(chalk.red("\n✗ Login failed:"), error.message);
    process.exit(1);
  }
}

/**
 * Logout command handler
 */
async function logoutHandler() {
  const { clearTokens } = await import("../../auth/token-storage");
  clearTokens();
  console.log(chalk.green("✓ Logged out successfully"));
}

/**
 * Whoami command handler (show current user)
 */
async function whoamiHandler() {
  const tokens = loadTokens();

  if (!tokens) {
    console.log(chalk.yellow("Not logged in"));
    console.log(chalk.dim("Run 'flutch login' to authenticate"));
    return;
  }

  const userInfo = getUserFromToken(tokens.idToken);

  if (userInfo) {
    console.log(chalk.green("✓ Logged in as:"), userInfo.email);
    console.log(chalk.dim("User ID:"), userInfo.sub);
    if (userInfo.name) {
      console.log(chalk.dim("Name:"), userInfo.name);
    }
  } else {
    console.log(chalk.yellow("Unable to decode user information"));
  }
}

export const loginCommand = new Command("login")
  .description("Authenticate with Flutch using web-based OAuth flow")
  .action(loginHandler);

export const logoutCommand = new Command("logout")
  .description("Log out and clear stored credentials")
  .action(logoutHandler);

export const whoamiCommand = new Command("whoami")
  .description("Show current authenticated user")
  .action(whoamiHandler);
