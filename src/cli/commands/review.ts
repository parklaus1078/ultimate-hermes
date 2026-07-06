import type { Command } from "commander";
import { daysAgo } from "../../core/time.js";
import { EventRepository } from "../../db/events.js";

export function registerReview(program: Command): void {
  const review = program.command("review").description("Review commands.");

  review
    .command("weekly")
    .description("Generate a weekly local review event.")
    .action(async () => {
      const events = new EventRepository();
      const recent = await events.listSince(daysAgo(7));
      const lines = recent.map((event) => `- ${event.occurredAt.toISOString()} [${event.type}] ${event.title}`);
      const reviewEvent = await events.create({
        type: "system",
        sensitivity: "personal",
        title: `Weekly review ${new Date().toISOString().slice(0, 10)}`,
        body: lines.join("\n") || "No events captured this week.",
        createdByProfile: "chief-of-staff",
        confidence: "agent_inferred",
        metadata: { sourceEventCount: recent.length }
      });
      console.log(`Created weekly review: ${reviewEvent.id}`);
    });
}
