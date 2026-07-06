import { EventRepository } from "../../db/events.js";

export async function recordLinearWebhook(payload: Record<string, unknown>): Promise<string> {
  const event = await new EventRepository().create({
    type: "ticket",
    sensitivity: "personal",
    title: `Linear webhook: ${String(payload.type ?? "unknown")}`,
    summary: "Imported Linear webhook payload.",
    body: JSON.stringify(payload, null, 2),
    confidence: "imported",
    createdByProfile: "linear-sync-manager",
    metadata: { linearWebhook: payload }
  });
  return event.id;
}
