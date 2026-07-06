import type { Command } from "commander";
import { createSecretStore } from "../../secrets/index.js";
import { printJson } from "../output.js";

export function registerSecrets(program: Command): void {
  const secrets = program.command("secrets").description("Secret store commands.");

  secrets
    .command("set")
    .description("Store a secret in the active secret store.")
    .argument("<service>")
    .argument("<account>")
    .argument("<value>")
    .action(async (service: string, account: string, value: string) => {
      const store = createSecretStore();
      await store.set(service, account, value);
      printJson({ ok: true, store: store.describe(), service, account });
    });

  secrets
    .command("get")
    .description("Check whether a secret exists without printing it.")
    .argument("<service>")
    .argument("<account>")
    .action(async (service: string, account: string) => {
      const store = createSecretStore();
      const value = await store.get(service, account);
      printJson({ exists: Boolean(value), store: store.describe(), service, account });
    });

  secrets
    .command("delete")
    .description("Delete a secret from the active secret store.")
    .argument("<service>")
    .argument("<account>")
    .action(async (service: string, account: string) => {
      const store = createSecretStore();
      await store.delete(service, account);
      printJson({ ok: true, store: store.describe(), service, account });
    });
}
