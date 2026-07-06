import type { SecretStore } from "./secret-store.js";

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  describe(): string {
    return "memory";
  }

  async get(service: string, account: string): Promise<string | null> {
    return this.values.get(`${service}:${account}`) ?? null;
  }

  async set(service: string, account: string, value: string): Promise<void> {
    this.values.set(`${service}:${account}`, value);
  }

  async delete(service: string, account: string): Promise<void> {
    this.values.delete(`${service}:${account}`);
  }
}
