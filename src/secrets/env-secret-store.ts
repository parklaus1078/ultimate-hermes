import type { SecretStore } from "./secret-store.js";
import { envName } from "./secret-store.js";

export class EnvSecretStore implements SecretStore {
  describe(): string {
    return "environment";
  }

  async get(service: string, account: string): Promise<string | null> {
    return process.env[envName(service, account)] ?? null;
  }

  async set(): Promise<void> {
    throw new Error("EnvSecretStore is read-only. Set secrets through environment variables or Docker secrets.");
  }

  async delete(): Promise<void> {
    throw new Error("EnvSecretStore is read-only.");
  }
}
