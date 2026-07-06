import type { Command } from "commander";
import { createCliContext } from "../context.js";
import { printJson } from "../output.js";

export function registerCapture(program: Command): void {
  program
    .command("capture")
    .description("Capture a memory event into the local Hermes ledger.")
    .argument("<text...>", "Text to capture")
    .option("--type <type>", "event type", "document")
    .option("--sensitivity <sensitivity>", "sensitivity", "personal")
    .option("--profile <profile>", "agent profile", "capture-router")
    .option("--source-url <url>", "optional source URL")
    .action(async (textParts: string[], options: { type: string; sensitivity: string; profile: string; sourceUrl?: string }) => {
      const ctx = createCliContext();
      const text = textParts.join(" ");
      const run = await ctx.audit.startRun({
        profileId: options.profile,
        command: "capture",
        input: { text, options }
      });
      try {
        const event = await ctx.events.create({
          type: options.type as never,
          sensitivity: options.sensitivity as never,
          title: text.slice(0, 120),
          body: text,
          createdByProfile: options.profile,
          confidence: "human_confirmed"
        });
        if (options.sourceUrl) {
          await ctx.sources.create({
            eventId: event.id,
            kind: "url",
            sourceUri: options.sourceUrl
          });
        }
        await ctx.audit.finishRun(run.id, "succeeded", { event }, [event.id]);
        printJson(event);
      } catch (error) {
        await ctx.audit.finishRun(run.id, "failed", { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    });
}
