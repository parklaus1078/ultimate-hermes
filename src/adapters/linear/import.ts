import type { SecretStore } from "../../secrets/secret-store.js";
import { EventRepository } from "../../db/events.js";
import { ExternalRefRepository } from "../../db/external-refs.js";
import { LinearClient } from "./client.js";

export async function importLinearIssues(secretStore: SecretStore, limit = 50): Promise<{ imported: number; skipped: number }> {
  const client = new LinearClient(secretStore);
  const issues = await client.listIssues(limit);
  const events = new EventRepository();
  const refs = new ExternalRefRepository();
  let imported = 0;
  let skipped = 0;

  for (const issue of issues) {
    const existing = await refs.findByExternal("linear", issue.id);
    if (existing) {
      skipped += 1;
      continue;
    }
    const event = await events.create({
      type: "ticket",
      sensitivity: "personal",
      title: `${issue.identifier} ${issue.title}`,
      summary: issue.description ?? null,
      confidence: "imported",
      createdByProfile: "linear-sync-manager",
      metadata: {
        linear: issue,
        linearExportPolicy: "linear_exported"
      }
    });
    await refs.upsert({
      hermesObjectType: "event",
      hermesObjectId: event.id,
      system: "linear",
      externalId: issue.id,
      externalUrl: issue.url,
      syncDirection: "imported",
      metadata: { identifier: issue.identifier }
    });
    imported += 1;
  }

  return { imported, skipped };
}
