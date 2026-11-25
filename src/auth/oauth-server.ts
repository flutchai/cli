import * as http from "http";
import * as url from "url";
import axios from "axios";
import chalk from "chalk";
import { TokenData, saveTokens } from "./token-storage";

interface OAuthCallbackParams {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
  // Direct token response (instead of code)
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: string;
  token_type?: string;
}

/**
 * Start local OAuth callback server
 * @returns Promise with port number and authorization code
 */
export async function startOAuthServer(expectedState: string): Promise<{
  port: number;
  codePromise: Promise<string>;
  server: http.Server;
}> {
  return new Promise((resolve, reject) => {
    let codeResolve: (code: string) => void;
    let codeReject: (error: Error) => void;

    const codePromise = new Promise<string>((res, rej) => {
      codeResolve = res;
      codeReject = rej;
    });

    const server = http.createServer((req, res) => {
      // Only handle callback path
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const parsedUrl = url.parse(req.url, true);
      const params = parsedUrl.query as unknown as OAuthCallbackParams;

      // Check for errors
      if (params.error) {
        const errorMsg = params.error_description || params.error;
        console.error(chalk.red("✗ Authorization failed:"), errorMsg);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Authorization Failed</title>
              <style>
                body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
                .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; }
                .error { color: #d32f2f; margin-bottom: 16px; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1 class="error">✗ Authorization Failed</h1>
                <p>${errorMsg}</p>
                <p>You can close this window and return to the terminal.</p>
              </div>
            </body>
          </html>
        `);

        codeReject(new Error(errorMsg));
        return;
      }

      // The state must be the one this login sent, or the code is somebody else's.
      if (params.code && params.state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Invalid Request</h1><p>Unexpected state.</p>");
        codeReject(new Error("State mismatch: the callback was not for this login"));
        return;
      }

      if (params.code) {
        console.log(chalk.green("✓ Authorization code received"));

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Authorization Successful</title>
              <style>
                body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
                .container { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; }
                .success { color: #2e7d32; margin-bottom: 16px; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1 class="success">✓ Successfully Authenticated!</h1>
                <p>You can close this window and return to the terminal.</p>
              </div>
            </body>
          </html>
        `);

        codeResolve(params.code);
        return;
      }

      // No code or error
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Invalid Request</title></head>
          <body>
            <h1>Invalid Request</h1>
            <p>Missing authorization code or error parameter.</p>
          </body>
        </html>
      `);
      codeReject(new Error("Invalid OAuth callback"));
    });

    // Set timeout for server
    const timeout = setTimeout(
      () => {
        server.close();
        codeReject(new Error("Authorization timeout (5 minutes)"));
      },
      5 * 60 * 1000
    );

    // Clear timeout when code is received
    codePromise.finally(() => {
      clearTimeout(timeout);
      // Close server after a short delay to ensure response is sent
      setTimeout(() => server.close(), 1000);
    });

    // Start server on random available port
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to start server"));
        return;
      }

      const port = address.port;
      console.log(chalk.dim(`→ Local callback server started on port ${port}`));

      resolve({ port, codePromise, server });
    });

    server.on("error", error => {
      reject(error);
    });
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  cognitoConfig: {
    domain: string;
    clientId: string;
    region: string;
  }
): Promise<TokenData> {
  const tokenEndpoint = `https://${cognitoConfig.domain}/oauth2/token`;

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cognitoConfig.clientId,
    code,
    redirect_uri: redirectUri,
  });

  try {
    const response = await axios.post(tokenEndpoint, params.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const { access_token, refresh_token, id_token, expires_in } = response.data;

    const tokens: TokenData = {
      accessToken: access_token,
      refreshToken: refresh_token,
      idToken: id_token,
      expiresAt: Date.now() + expires_in * 1000,
    };

    saveTokens(tokens);
    return tokens;
  } catch (error: any) {
    if (error.response) {
      throw new Error(
        `Token exchange failed: ${error.response.data?.error_description || error.response.data?.error || error.message}`
      );
    }
    throw error;
  }
}
