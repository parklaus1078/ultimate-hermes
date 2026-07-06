import type { Command } from "commander";
import { loadConfig } from "../../config/env.js";
import { migrate } from "../../db/client.js";
import { profiles } from "../../core/profiles.js";
import { createSecretStore, envName } from "../../secrets/index.js";
import { checkNotionConnection } from "../../adapters/notion/import.js";
import { LinearClient } from "../../adapters/linear/client.js";
import { GoogleOAuthClient } from "../../adapters/google/oauth.js";
import { printJson } from "../output.js";

export function registerSystem(program: Command): void {
  program
    .command("migrate")
    .description("Run Postgres migrations.")
    .action(async () => {
      const applied = await migrate();
      if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);
      else console.log("Database is already up to date.");
    });

  const setup = program.command("setup").description("Setup and diagnostics.");

  setup
    .command("check")
    .description("Check local config, DB migrations, profiles, and configured secret refs.")
    .option("--live", "also check live SaaS API connections")
    .action(async (options: { live?: boolean }) => {
      const config = loadConfig();
      const secretStore = createSecretStore();
      const report: Record<string, unknown> = {
        databaseUrl: config.databaseUrl.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@"),
        secretStore: secretStore.describe(),
        profiles: profiles.map((profile) => profile.id),
        keychainRefs: config.keychain
      };

      if (options.live) {
        const live: Record<string, string> = {};
        try {
          const viewer = await new LinearClient(secretStore).viewer();
          live.linear = `ok: ${viewer.email}`;
        } catch (error) {
          live.linear = `failed: ${error instanceof Error ? error.message : String(error)}`;
        }
        try {
          await checkNotionConnection(secretStore);
          live.notion = "ok";
        } catch (error) {
          live.notion = `failed: ${error instanceof Error ? error.message : String(error)}`;
        }
        try {
          const url = await new GoogleOAuthClient(secretStore).authUrl(`http://${config.host}:${config.port}/oauth/google/callback`);
          live.googleOAuth = `ready: ${url}`;
        } catch (error) {
          live.googleOAuth = `failed: ${error instanceof Error ? error.message : String(error)}`;
        }
        report.live = live;
      }

      printJson(report);
    });

  setup
    .command("google-auth-url")
    .description("Print Google OAuth URL after Google client_id/client_secret are stored.")
    .option("--redirect-uri <uri>", "redirect URI")
    .action(async (options: { redirectUri?: string }) => {
      const config = loadConfig();
      const secretStore = createSecretStore();
      const redirectUri = options.redirectUri ?? `http://${config.host}:${config.port}/oauth/google/callback`;
      console.log(await new GoogleOAuthClient(secretStore).authUrl(redirectUri));
    });

  setup
    .command("env-secret-name")
    .description("Print the env var name for a secret service/account pair.")
    .argument("<service>")
    .argument("<account>")
    .action((service: string, account: string) => {
      console.log(envName(service, account));
    });
}
