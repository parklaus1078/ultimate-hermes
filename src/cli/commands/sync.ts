import type { Command } from "commander";
import { importLinearIssues } from "../../adapters/linear/import.js";
import { checkNotionConnection } from "../../adapters/notion/import.js";
import { databasePropertiesFor, notionDatabasePlan } from "../../adapters/notion/databases.js";
import { NotionClient } from "../../adapters/notion/client.js";
import { checkGoogleCalendar } from "../../adapters/google/calendar.js";
import { checkGoogleDrive } from "../../adapters/google/drive.js";
import { checkGmail } from "../../adapters/google/gmail.js";
import { createSecretStore } from "../../secrets/index.js";
import { printJson } from "../output.js";

export function registerSync(program: Command): void {
  const sync = program.command("sync").description("SaaS sync commands.");

  sync
    .command("linear")
    .description("Import Linear issues into Hermes.")
    .option("--limit <limit>", "issue limit", "50")
    .action(async (options: { limit: string }) => {
      const result = await importLinearIssues(createSecretStore(), Number.parseInt(options.limit, 10));
      printJson(result);
    });

  sync
    .command("notion")
    .description("Check Notion API connectivity.")
    .action(async () => {
      printJson(await checkNotionConnection(createSecretStore()));
    });

  sync
    .command("notion-create-databases")
    .description("Create basic Hermes Notion inventory databases under a parent page.")
    .argument("<parentPageId>")
    .action(async (parentPageId: string) => {
      const client = new NotionClient(createSecretStore());
      const created = [];
      for (const name of notionDatabasePlan) {
        created.push(await client.createDatabase({
          parentPageId,
          title: `Hermes ${name}`,
          properties: databasePropertiesFor(name)
        }));
      }
      printJson({ created });
    });

  sync
    .command("google-calendar")
    .description("Check Google Calendar connectivity.")
    .action(async () => {
      printJson(await checkGoogleCalendar(createSecretStore()));
    });

  sync
    .command("google-drive")
    .description("Check Google Drive connectivity.")
    .action(async () => {
      printJson(await checkGoogleDrive(createSecretStore()));
    });

  sync
    .command("gmail")
    .description("Check Gmail connectivity.")
    .action(async () => {
      printJson(await checkGmail(createSecretStore()));
    });
}
