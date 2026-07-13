import { LifeArchiveRepository } from "./lifeArchive.js";

export type ToolResult = Record<string, unknown> | string;

function asObject(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

function stringArg(args: Record<string, unknown>, name: string, fallback?: string): string {
  const value = args[name];
  if (typeof value === "string" && value.length > 0) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required string argument: ${name}`);
}

function intArg(args: Record<string, unknown>, name: string, fallback: number, max = 100): number {
  const raw = args[name];
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export async function recentEvents(argsInput: unknown = {}): Promise<ToolResult> {
  const args = asObject(argsInput);
  return { sourceTable: "life_events", events: await new LifeArchiveRepository().recent(intArg(args, "limit", 25, 100)) };
}

export async function recallEvents(argsInput: unknown): Promise<ToolResult> {
  const args = asObject(argsInput);
  const query = stringArg(args, "query");
  const limit = intArg(args, "limit", 10, 50);
  return { sourceTable: "life_events", query, results: await new LifeArchiveRepository().recall(query, limit) };
}

export async function timeline(argsInput: unknown): Promise<ToolResult> {
  const args = asObject(argsInput);
  const topic = stringArg(args, "topic");
  const limit = intArg(args, "limit", 100, 250);
  return { sourceTable: "life_events", topic, events: await new LifeArchiveRepository().timeline(topic, limit) };
}

export async function captureEvent(argsInput: unknown): Promise<ToolResult> {
  const args = asObject(argsInput);
  stringArg(args, "title");
  return { sourceTable: "life_events", event: await new LifeArchiveRepository().capture(args) };
}

export async function contextPack(argsInput: unknown): Promise<ToolResult> {
  const args = asObject(argsInput);
  const query = stringArg(args, "query");
  const limit = intArg(args, "limit", 8, 20);
  const repo = new LifeArchiveRepository();
  const results = await repo.recall(query, limit);
  const recent = await repo.recent(5);

  const sections = [
    `# Ultimate Hermes Context Pack: ${query}`,
    "",
    "## Source of Truth",
    "- Life Archive / Postgres `life_events` is the durable source of truth.",
    "- Notion is human-readable inventory/spec/log surface.",
    "- Linear is the active execution board.",
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
    ...recent.map((event) => `- ${event.occurredAt.toISOString()} — ${event.title} (${event.id})`)
  ];

  return sections.join("\n");
}

export const remoteTools = {
  recent_events: recentEvents,
  recall_events: recallEvents,
  timeline,
  capture_event: captureEvent,
  context_pack: contextPack
};

export type RemoteToolName = keyof typeof remoteTools;

export async function callRemoteTool(name: string, args: unknown): Promise<ToolResult> {
  const tool = remoteTools[name as RemoteToolName];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool(args);
}
