import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SecretStore } from "./secret-store.js";

const execFileAsync = promisify(execFile);

export class MacOSKeychainSecretStore implements SecretStore {
  describe(): string {
    return "macOS Keychain";
  }

  async get(service: string, account: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", service, "-a", account, "-w"]);
      return stdout.trimEnd();
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? (error as { code?: number }).code : undefined;
      if (code === 44) return null;
      return null;
    }
  }

  async set(service: string, account: string, value: string): Promise<void> {
    await execFileAsync("security", ["add-generic-password", "-U", "-s", service, "-a", account, "-w", value]);
  }

  async delete(service: string, account: string): Promise<void> {
    try {
      await execFileAsync("security", ["delete-generic-password", "-s", service, "-a", account]);
    } catch {
      // Treat missing secrets as already deleted.
    }
  }
}
