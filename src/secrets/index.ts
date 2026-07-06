import { EnvSecretStore } from "./env-secret-store.js";
import { MacOSKeychainSecretStore } from "./keychain.js";
import type { SecretStore } from "./secret-store.js";

export function createSecretStore(): SecretStore {
  if (process.env.HERMES_SECRET_STORE === "env") return new EnvSecretStore();
  if (process.platform === "darwin") return new MacOSKeychainSecretStore();
  return new EnvSecretStore();
}

export * from "./secret-store.js";
