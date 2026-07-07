import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({
  path: path.join(process.env.HERMES_HOME ?? path.join(os.homedir(), ".hermes"), ".env")
});

export type AppConfig = {
  databaseUrl: string;
  port: number;
  host: string;
  dataDir: string;
  embeddingProvider: "local" | "http";
  embeddingDimensions: number;
  embeddingUrl: string;
  embeddingModel: string;
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

export function loadConfig(): AppConfig {
  const embeddingProvider = (process.env.HERMES_EMBEDDING_PROVIDER ?? "local") as AppConfig["embeddingProvider"];
  if (!["local", "http"].includes(embeddingProvider)) {
    throw new Error(`Unsupported HERMES_EMBEDDING_PROVIDER=${embeddingProvider}`);
  }

  return {
    databaseUrl: strEnv("HERMES_DATABASE_URL", "postgres://hermes:hermes@localhost:55432/hermes"),
    port: intEnv("HERMES_PORT", 8787),
    host: strEnv("HERMES_HOST", "127.0.0.1"),
    dataDir: strEnv("HERMES_DATA_DIR", ".hermes"),
    embeddingProvider,
    embeddingDimensions: intEnv("HERMES_EMBEDDING_DIMENSIONS", 1536),
    embeddingUrl: strEnv("HERMES_EMBEDDING_URL", "https://api.openai.com/v1/embeddings"),
    embeddingModel: strEnv("HERMES_EMBEDDING_MODEL", "text-embedding-3-small"),
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
