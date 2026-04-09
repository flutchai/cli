import * as crypto from "crypto";

export interface InitConfig {
  projectName: string;
  agentName: string;
  agentDescription: string;
  openaiKey?: string;
  anthropicKey?: string;
  port: number;
  adminPassword: string;
  jwtSecret: string;
  enableWebSearch: boolean;
  tavilyKey?: string;
}

export function generateSecrets(): Pick<InitConfig, "adminPassword" | "jwtSecret"> {
  return {
    adminPassword: crypto.randomBytes(8).toString("hex"),
    jwtSecret: crypto.randomBytes(32).toString("hex"),
  };
}

export function dockerCompose(cfg: InitConfig): string {
  return `services:
  engine:
    # Pre-built image (use when published):
    image: ghcr.io/flutchai/flutch-oss:latest
    # Build from source (clone flutchai/flutch-oss here first):
    # build: .
    ports:
      - "${cfg.port}:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://flutch:flutch@postgres:5432/flutch_oss
      CONFIG_MODE: local
      OPENAI_API_KEY: \${OPENAI_API_KEY:-}
      ANTHROPIC_API_KEY: \${ANTHROPIC_API_KEY:-}
      MCP_RUNTIME_URL: http://mcp-runtime:3004
      ADMIN_PASSWORD: \${ADMIN_PASSWORD}
      ADMIN_JWT_SECRET: \${ADMIN_JWT_SECRET}
    volumes:
      - ./agents.json:/app/agents.json:ro
    depends_on:
      postgres:
        condition: service_healthy
      mcp-runtime:
        condition: service_healthy
    restart: unless-stopped

  mcp-runtime:
    # Pre-built image (use when published):
    image: ghcr.io/flutchai/mcp-runtime:latest
    # Build from source (clone flutchai/mcp-runtime here first):
    # build:
    #   context: ./mcp-runtime
    volumes:
      - ./mcp-servers.json:/app/mcp-servers.json:ro
    environment:
      TAVILY_API_KEY: \${TAVILY_API_KEY:-}
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3004/health', r => process.exit(r.statusCode === 200 ? 0 : 1))"]
      interval: 15s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: flutch
      POSTGRES_PASSWORD: flutch
      POSTGRES_DB: flutch_oss
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U flutch"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
`;
}

export function dotenv(cfg: InitConfig): string {
  const lines: string[] = [];
  if (cfg.openaiKey) lines.push(`OPENAI_API_KEY=${cfg.openaiKey}`);
  if (cfg.anthropicKey) lines.push(`ANTHROPIC_API_KEY=${cfg.anthropicKey}`);
  if (cfg.enableWebSearch && cfg.tavilyKey) lines.push(`TAVILY_API_KEY=${cfg.tavilyKey}`);
  lines.push(``, `ADMIN_PASSWORD=${cfg.adminPassword}`, `ADMIN_JWT_SECRET=${cfg.jwtSecret}`);
  return lines.join("\n") + "\n";
}

export function agentsJson(cfg: InitConfig): string {
  const id = cfg.agentName.toLowerCase().replace(/\s+/g, "-");
  return (
    JSON.stringify(
      {
        [id]: {
          graphType: "flutch.simple",
          graphSettings: {
            model: cfg.openaiKey ? "gpt-4o-mini" : "claude-3-5-haiku-20241022",
            systemPrompt: cfg.agentDescription,
          },
        },
      },
      null,
      2
    ) + "\n"
  );
}

export function mcpServersJson(cfg: InitConfig): string {
  const servers: any[] = [
    {
      name: "sequential-thinking",
      transport: "stdio",
      command: "npx",
      args: ["-y", "--quiet", "@modelcontextprotocol/server-sequential-thinking"],
      enabled: true,
    },
  ];
  if (cfg.enableWebSearch) {
    servers.push({
      name: "web-search",
      transport: "stdio",
      command: "npx",
      args: ["-y", "--quiet", "tavily-mcp@0.1.4"],
      env: { TAVILY_API_KEY: "${TAVILY_API_KEY}" },
      enabled: true,
    });
  }
  return JSON.stringify({ servers }, null, 2) + "\n";
}

export function gitignore(): string {
  return `.env\nnode_modules/\n`;
}
