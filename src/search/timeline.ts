import type { HermesEvent } from "../core/types.js";
import { RecallService } from "./recall.js";

export function formatTimeline(events: HermesEvent[]): string {
  if (!events.length) return "No matching timeline records found.";
  return events
    .map((event) => {
      const summary = event.summary ? `\n  ${event.summary}` : "";
      return `- ${event.occurredAt.toISOString()} [${event.type}/${event.sensitivity}] ${event.title}${summary}\n  id: ${event.id}`;
    })
    .join("\n");
}

export async function buildTimeline(topic: string, recall = new RecallService()): Promise<string> {
  return formatTimeline(await recall.timeline(topic));
}
