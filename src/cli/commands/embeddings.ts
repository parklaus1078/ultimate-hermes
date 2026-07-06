import type { Command } from "commander";
import { EventRepository } from "../../db/events.js";
import { EmbeddingRepository } from "../../search/embeddings.js";
import { createCliContext } from "../context.js";
import { printJson } from "../output.js";

export function registerEmbeddings(program: Command): void {
  const embeddings = program.command("embeddings").description("Embedding index commands.");

  embeddings
    .command("generate")
    .description("Generate embeddings for recent eligible events.")
    .option("--limit <limit>", "recent event limit", "100")
    .action(async (options: { limit: string }) => {
      const ctx = createCliContext();
      const events = await new EventRepository().listRecent(Number.parseInt(options.limit, 10));
      const embedded = await new EmbeddingRepository(ctx.embeddingProvider).regenerate(events);
      printJson({ embedded, skipped: events.length - embedded });
    });
}
