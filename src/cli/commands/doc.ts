import { access } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { sha256File } from "../../core/files.js";
import { createCliContext } from "../context.js";
import { printJson } from "../output.js";

export function registerDoc(program: Command): void {
  const doc = program.command("doc").description("Document source commands.");

  doc
    .command("add")
    .description("Add a local file or URL as a source event.")
    .argument("<source>", "file path or URL")
    .option("--type <type>", "event type", "document")
    .option("--sensitivity <sensitivity>", "sensitivity", "personal")
    .option("--title <title>", "title")
    .action(async (source: string, options: { type: string; sensitivity: string; title?: string }) => {
      const ctx = createCliContext();
      const isUrl = /^https?:\/\//.test(source);
      let sha256: string | null = null;
      let sourceUri = source;

      if (!isUrl) {
        const absolute = path.resolve(source);
        await access(absolute);
        sourceUri = absolute;
        sha256 = await sha256File(absolute);
      }

      const event = await ctx.events.create({
        type: options.type as never,
        sensitivity: options.sensitivity as never,
        title: options.title ?? path.basename(source),
        summary: isUrl ? `Captured URL: ${source}` : `Captured file: ${sourceUri}`,
        createdByProfile: "archivist",
        confidence: "human_confirmed"
      });

      const sourceRecord = await ctx.sources.create({
        eventId: event.id,
        kind: isUrl ? "url" : "file",
        sourceUri,
        sha256
      });

      printJson({ event, source: sourceRecord });
    });
}
