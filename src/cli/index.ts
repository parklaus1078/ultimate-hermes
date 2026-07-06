#!/usr/bin/env node
import { Command } from "commander";
import { closeDb } from "../db/client.js";
import { registerApprovals } from "./commands/approvals.js";
import { registerCapture } from "./commands/capture.js";
import { registerDoc } from "./commands/doc.js";
import { registerEmbeddings } from "./commands/embeddings.js";
import { registerRecall } from "./commands/recall.js";
import { registerReview } from "./commands/review.js";
import { registerSecrets } from "./commands/secrets.js";
import { registerStatus } from "./commands/status.js";
import { registerSync } from "./commands/sync.js";
import { registerSystem } from "./commands/system.js";
import { printError } from "./output.js";

const program = new Command();

program
  .name("hermes")
  .description("Hermes Agent local daily-life memory CLI")
  .version("0.1.0");

registerSystem(program);
registerCapture(program);
registerDoc(program);
registerRecall(program);
registerReview(program);
registerStatus(program);
registerEmbeddings(program);
registerSecrets(program);
registerApprovals(program);
registerSync(program);

try {
  await program.parseAsync(process.argv);
  await closeDb();
} catch (error) {
  await closeDb();
  printError(error);
  process.exitCode = 1;
}
