import { loadConfig } from "../config/env.js";
import { createSecretStore } from "../secrets/index.js";
import { createEmbeddingProvider } from "../search/embedding-provider.js";
import { LifeArchiveRepository, type RecallOptions } from "./lifeArchive.js";

export type ToolResult = Record<string, unknown> | string;

function asObject(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

function stringArg(args: Record<string, unknown>, name: string, fallback?: string): string {
  const value = args[name];
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required string argument: ${name}`);
}

function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function intArg(args: Record<string, unknown>, name: string, fallback: number, max = 100): number {
  const raw = args[name];
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function recallOptions(args: Record<string, unknown>, fallbackLimit: number, maxLimit: number): RecallOptions {
  return {
    limit: intArg(args, "limit", fallbackLimit, maxLimit),
    eventType: optionalString(args, "type"),
    sensitivity: optionalString(args, "sensitivity"),
    project: optionalString(args, "project"),
    sessionId: optionalString(args, "sessionId") ?? optionalString(args, "session_id")
  };
}

async function addSemanticQuery(queryText: string, options: RecallOptions) {
  const config = loadConfig();
  if (config.embeddingProvider !== "http") {
    return { options, status: config.embeddingProvider === "disabled" ? "disabled" : "not-used-for-life-archive" };
  }
  try {
    const provider = createEmbeddingProvider(createSecretStore());
    const embedding = await provider.embed(queryText);
    return {
      options: { ...options, embedding, embeddingModel: provider.model },
      status: "enabled"
    };
  } catch {
    return { options, status: "unavailable" };
  }
}

function requireWritesEnabled(): void {
  if (!loadConfig().allowRemoteWrites) {
    throw new Error("Remote writes are disabled. Set HERMES_ALLOW_REMOTE_WRITES=true to enable append-only capture tools.");
  }
}

export async function recentEvents(argsInput: unknown = {}): Promise<ToolResult> {
  const args = asObject(argsInput);
  return { sourceTable: "life_events", events: await new LifeArchiveRepository().recent(intArg(args, "limit", 25, 100)) };
}

export async function recallEvents(argsInput: unknown): Promise<ToolResult> {
  const args = asObject(argsInput);
  const queryText = stringArg(args, "query");
  const semantic = await addSemanticQuery(queryText, recallOptions(args, 10, 50));
  return {
    sourceTable: "life_events",
    query: queryText,
    semanticRecall: semantic.status,
    results: await new LifeArchiveRepository().recall(queryText, semantic.options)
  };
}

export async function timeline(argsInput: unknown): Promise<ToolResult> {
  const args = asObject(argsInput);
  const topic = stringArg(args, "topic");
  const semantic = await addSemanticQuery(topic, recallOptions(args, 100, 250));
  return {
    sourceTable: "life_events",
    topic,
    semanticRecall: semantic.status,
    events: await new LifeArchiveRepository().timeline(topic, semantic.options)
  };
}

export async function captureEvent(argsInput: unknown): Promise<ToolResult> {
  requireWritesEnabled();
  const args = asObject(argsInput);
  stringArg(args, "title");
  const repo = new LifeArchiveRepository();
  const event = await repo.capture(args);
  const config = loadConfig();
  let embedding: "disabled" | "skipped-legal-sensitive" | "stored" | "failed" = "disabled";

  if (event.sensitivity === "legal_sensitive" && !config.embedLegalSensitive) {
    embedding = "skipped-legal-sensitive";
  } else if (config.embeddingProvider === "http") {
    try {
      const provider = createEmbeddingProvider(createSecretStore());
      await repo.upsertEmbedding(event, provider.model, await provider.embed([
        `Title: ${event.title}`,
        `Type: ${event.type}`,
        `Summary: ${event.summary ?? ""}`,
        `Body: ${event.body ?? ""}`
      ].join("\n")));
      embedding = "stored";
    } catch {
      embedding = "failed";
    }
  }

  return { sourceTable: "life_events", event, embedding };
}

export async function linkSource(argsInput: unknown): Promise<ToolResult> {
  requireWritesEnabled();
  const args = asObject(argsInput);
  const metadata = typeof args.metadata === "object" && args.metadata !== null && !Array.isArray(args.metadata)
    ? args.metadata as Record<string, unknown>
    : undefined;
  const source = await new LifeArchiveRepository().linkSource({
    eventId: stringArg(args, "event_id"),
    kind: stringArg(args, "kind"),
    sourceUri: stringArg(args, "source_uri"),
    externalId: optionalString(args, "external_id"),
    sha256: optionalString(args, "sha256"),
    metadata
  });
  return { sourceTable: "life_sources", source };
}

export async function projectStatus(argsInput: unknown): Promise<ToolResult> {
  const args = asObject(argsInput);
  return {
    sourceTable: "life_events",
    ...(await new LifeArchiveRepository().projectStatus(stringArg(args, "project"), intArg(args, "limit", 20, 100)))
  };
}

export async function memoryStatus(): Promise<ToolResult> {
  return new LifeArchiveRepository().memoryStatus();
}

export async function contextPack(argsInput: unknown): Promise<ToolResult> {
  const args = asObject(argsInput);
  const queryText = stringArg(args, "query");
  const semantic = await addSemanticQuery(queryText, recallOptions(args, 8, 20));
  const repo = new LifeArchiveRepository();
  const results = await repo.recall(queryText, semantic.options);
  const recent = await repo.recent(5);

  const sections = [
    `# Ultimate Hermes Context Pack: ${queryText}`,
    "",
    "## Source of Truth",
    "- Life Archive / Supabase Postgres `life_events` is the durable source of truth.",
    "- Notion is the human-readable inventory/spec/log surface.",
    "- Linear is the active execution board.",
    `- Semantic recall: ${semantic.status}.`,
    "",
    "## Recalled Life Archive Records",
    ...results.map((item, index) => {
      const event = item.event;
      return [
        `### ${index + 1}. ${event.title}`,
        `- id: ${event.id}`,
        `- type: ${event.type}`,
        `- sensitivity: ${event.sensitivity}`,
        `- confidence: ${event.confidence}`,
        `- occurredAt: ${event.occurredAt.toISOString()}`,
        `- project: ${typeof event.metadata?.project === "string" ? event.metadata.project : ""}`,
        `- match: ${item.matchKind} (${item.score.toFixed(3)})`,
        event.summary ? `- summary: ${event.summary}` : "",
        event.body ? `\n${event.body}` : ""
      ]
        .filter(Boolean)
        .join("\n");
    }),
    "",
    "## Recent Life Archive Events",
    ...recent.map((event) => `- ${event.occurredAt.toISOString()} - ${event.title} (${event.id})`)
  ];

  return sections.join("\n");
}

export const remoteTools = {
  recent_events: recentEvents,
  recall_events: recallEvents,
  timeline,
  context_pack: contextPack,
  project_status: projectStatus,
  memory_status: memoryStatus,
  capture_event: captureEvent,
  link_source: linkSource
};

export type RemoteToolName = keyof typeof remoteTools;

export async function callRemoteTool(name: string, args: unknown): Promise<ToolResult> {
  const tool = remoteTools[name as RemoteToolName];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool(args);
}
