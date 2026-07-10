import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { SecretStore } from "./secret-store.js";

const execFileAsync = promisify(execFile);

function runSecurityWithInput(args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("security", args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`security ${args[0]} failed with code ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(input);
  });
}

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
    await runSecurityWithInput(
      ["add-generic-password", "-U", "-s", service, "-a", account, "-w"],
      `${value}\n${value}\n`
    );
  }

  async delete(service: string, account: string): Promise<void> {
    try {
      await execFileAsync("security", ["delete-generic-password", "-s", service, "-a", account]);
    } catch {
      // Treat missing secrets as already deleted.
    }
  }
}
