import { describe, expect, it } from "vitest";
import { EnvSecretStore } from "../../src/secrets/env-secret-store.js";
import { envName } from "../../src/secrets/secret-store.js";

describe("EnvSecretStore", () => {
  it("maps service/account to stable env names", async () => {
    const service = "hermes-linear";
    const account = "default";
    const name = envName(service, account);
    process.env[name] = "lin_api_key";
    const store = new EnvSecretStore();
    await expect(store.get(service, account)).resolves.toBe("lin_api_key");
    delete process.env[name];
  });
});
