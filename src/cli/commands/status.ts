import type { Command } from "commander";
import { EventRepository } from "../../db/events.js";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Show recent Hermes state.")
    .option("--limit <limit>", "event count", "20")
    .action(async (options: { limit: string }) => {
      const events = await new EventRepository().listRecent(Number.parseInt(options.limit, 10));
      console.log(`Recent Hermes events (${events.length})`);
      for (const event of events) {
        console.log(`- ${event.occurredAt.toISOString()} [${event.type}/${event.sensitivity}] ${event.title}`);
      }
    });
}
