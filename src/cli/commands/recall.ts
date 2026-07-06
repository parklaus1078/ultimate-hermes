import type { Command } from "commander";
import { RecallService } from "../../search/recall.js";
import { formatTimeline } from "../../search/timeline.js";
import { createCliContext } from "../context.js";
import { printJson } from "../output.js";

export function registerRecall(program: Command): void {
  program
    .command("remember")
    .description("Recall old Hermes records.")
    .argument("<query...>", "query text")
    .option("--limit <limit>", "max results", "10")
    .option("--json", "print JSON")
    .action(async (queryParts: string[], options: { limit: string; json?: boolean }) => {
      const ctx = createCliContext();
      const recall = new RecallService(undefined, ctx.embeddingProvider);
      const results = await recall.remember({ queryText: queryParts.join(" "), limit: Number.parseInt(options.limit, 10) });
      if (options.json) {
        printJson(results);
        return;
      }
      if (!results.length) {
        console.log("No matching records found.");
        return;
      }
      for (const result of results) {
        console.log(`- ${result.event.occurredAt.toISOString()} [${result.matchKind}:${result.score.toFixed(3)}] ${result.event.title}`);
        console.log(`  id: ${result.event.id}`);
        console.log(`  reason: ${result.reason}`);
        if (result.event.summary) console.log(`  summary: ${result.event.summary}`);
      }
    });

  program
    .command("timeline")
    .description("Build a chronological timeline for a topic.")
    .argument("<topic...>", "topic")
    .option("--limit <limit>", "max events", "100")
    .action(async (topicParts: string[], options: { limit: string }) => {
      const recall = new RecallService();
      const events = await recall.timeline(topicParts.join(" "), Number.parseInt(options.limit, 10));
      console.log(formatTimeline(events));
    });
}
