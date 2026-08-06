import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({
  path: path.join(process.env.HERMES_HOME ?? path.join(os.homedir(), ".hermes"), ".env")
});

export type AppConfig = {
  nodeEnv: string;
  databaseUrl: string;
  migrationDatabaseUrl: string;
  databaseMaxConnections: number;
  databaseConnectionTimeoutMs: number;
  databaseIdleTimeoutMs: number;
  port: number;
  host: string;
  publicBaseUrl: string;
  apiToken: string | null;
  allowedHosts: string[];
  allowedOrigins: string[];
  allowRemoteWrites: boolean;
  enableLegacyRoutes: boolean;
  dataDir: string;
  embeddingProvider: "disabled" | "local" | "http";
  embeddingDimensions: number;
  embeddingUrl: string;
  embeddingModel: string;
  embedLegalSensitive: boolean;
  keychain: {
    linear: { service: string; account: string };
    notion: { service: string; account: string };
    googleClient: { service: string; clientIdAccount: string; clientSecretAccount: string };
    googleToken: { service: string; account: string };
    embedding: { service: string; account: string };
  };
};

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid integer env var ${name}: ${raw}`);
  return parsed;
}

function strEnv(name: string, fallback?: string): string {
  const raw = process.env[name] ?? fallback;
  if (raw === undefined || raw.length === 0) throw new Error(`Missing required env var ${name}`);
  return raw;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw.trim().toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(raw.trim().toLowerCase())) return false;
  throw new Error(`Invalid boolean env var ${name}: ${raw}`);
}

function csvEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function publicBaseUrl(host: string, port: number): string {
  const configured = process.env.HERMES_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const renderHostname = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
  if (renderHostname) return `https://${renderHostname}`;
  return `http://${host}:${port}`;
}

function defaultAllowedHosts(baseUrl: string, host: string): string[] {
  const defaults = new Set(["127.0.0.1", "localhost", "::1"]);
  if (host !== "0.0.0.0" && host !== "::") defaults.add(host);
  try {
    defaults.add(new URL(baseUrl).hostname);
  } catch {
    // loadConfig will still surface malformed URLs where they are used.
  }
  for (const value of csvEnv("HERMES_ALLOWED_HOSTS")) defaults.add(value);
  return [...defaults];
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV?.trim() || "development";
  const port = intEnv("HERMES_PORT", intEnv("PORT", 8787));
  const host = strEnv("HERMES_HOST", nodeEnv === "production" ? "0.0.0.0" : "127.0.0.1");
  const baseUrl = publicBaseUrl(host, port);
  const databaseUrl = strEnv("HERMES_DATABASE_URL", "postgres://hermes:hermes@localhost:55432/hermes");
  const hasEmbeddingKey = Boolean(
    process.env.HERMES_EMBEDDING_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.HERMES_SECRET_HERMES_EMBEDDING_DEFAULT
  );
  const embeddingProvider = (process.env.HERMES_EMBEDDING_PROVIDER ?? (hasEmbeddingKey ? "http" : "disabled")) as AppConfig["embeddingProvider"];
  if (!["disabled", "local", "http"].includes(embeddingProvider)) {
    throw new Error(`Unsupported HERMES_EMBEDDING_PROVIDER=${embeddingProvider}`);
  }

  return {
    nodeEnv,
    databaseUrl,
    migrationDatabaseUrl: strEnv("HERMES_MIGRATION_DATABASE_URL", databaseUrl),
    databaseMaxConnections: intEnv("HERMES_DATABASE_MAX_CONNECTIONS", 5),
    databaseConnectionTimeoutMs: intEnv("HERMES_DATABASE_CONNECTION_TIMEOUT_MS", 10_000),
    databaseIdleTimeoutMs: intEnv("HERMES_DATABASE_IDLE_TIMEOUT_MS", 30_000),
    port,
    host,
    publicBaseUrl: baseUrl,
    apiToken: process.env.HERMES_API_TOKEN?.trim() || null,
    allowedHosts: defaultAllowedHosts(baseUrl, host),
    allowedOrigins: csvEnv("HERMES_ALLOWED_ORIGINS"),
    allowRemoteWrites: boolEnv("HERMES_ALLOW_REMOTE_WRITES", false),
    enableLegacyRoutes: boolEnv("HERMES_ENABLE_LEGACY_ROUTES", false),
    dataDir: strEnv("HERMES_DATA_DIR", ".hermes"),
    embeddingProvider,
    embeddingDimensions: intEnv("HERMES_EMBEDDING_DIMENSIONS", 1536),
    embeddingUrl: strEnv("HERMES_EMBEDDING_URL", "https://api.openai.com/v1/embeddings"),
    embeddingModel: strEnv("HERMES_EMBEDDING_MODEL", "text-embedding-3-small"),
    embedLegalSensitive: boolEnv("HERMES_EMBED_LEGAL_SENSITIVE", false),
    keychain: {
      linear: {
        service: strEnv("HERMES_LINEAR_KEYCHAIN_SERVICE", "hermes-linear"),
        account: strEnv("HERMES_LINEAR_KEYCHAIN_ACCOUNT", "default")
      },
      notion: {
        service: strEnv("HERMES_NOTION_KEYCHAIN_SERVICE", "hermes-notion"),
        account: strEnv("HERMES_NOTION_KEYCHAIN_ACCOUNT", "default")
      },
      googleClient: {
        service: strEnv("HERMES_GOOGLE_CLIENT_KEYCHAIN_SERVICE", "hermes-google-client"),
        clientIdAccount: strEnv("HERMES_GOOGLE_CLIENT_ID_ACCOUNT", "client-id"),
        clientSecretAccount: strEnv("HERMES_GOOGLE_CLIENT_SECRET_ACCOUNT", "client-secret")
      },
      googleToken: {
        service: strEnv("HERMES_GOOGLE_TOKEN_KEYCHAIN_SERVICE", "hermes-google-token"),
        account: strEnv("HERMES_GOOGLE_TOKEN_ACCOUNT", "default")
      },
      embedding: {
        service: strEnv("HERMES_EMBEDDING_KEYCHAIN_SERVICE", "hermes-embedding"),
        account: strEnv("HERMES_EMBEDDING_KEYCHAIN_ACCOUNT", "default")
      }
    }
  };
}
