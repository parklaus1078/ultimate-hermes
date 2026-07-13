import { randomUUID } from "node:crypto";
import { query } from "../db/client.js";

export type LifeArchiveEvent = {
  id: string;
  occurredAt: Date;
  type: string;
  sensitivity: string;
  title: string;
  summary: string | null;
  body: string | null;
  confidence: string;
  createdByProfile: string;
  sessionId: string | null;
  platform: string | null;
  sourceKind: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type RecallResult = {
  event: LifeArchiveEvent;
  matchKind: "keyword" | "fuzzy";
  score: number;
  reason: string;
};

function eventFromRow(row: Record<string, unknown>): LifeArchiveEvent {
  return {
    id: String(row.id),
    occurredAt: row.occurred_at as Date,
    type: String(row.type),
    sensitivity: String(row.sensitivity),
    title: String(row.title),
    summary: row.summary == null ? null : String(row.summary),
    body: row.body == null ? null : String(row.body),
    confidence: String(row.confidence),
    createdByProfile: String(row.created_by_profile),
    sessionId: row.session_id == null ? null : String(row.session_id),
    platform: row.platform == null ? null : String(row.platform),
    sourceKind: String(row.source_kind),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    archivedAt: row.archived_at == null ? null : (row.archived_at as Date)
  };
}

function cleanLimit(value: unknown, fallback = 10, max = 100): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export class LifeArchiveRepository {
  async recent(limitInput: unknown = 25): Promise<LifeArchiveEvent[]> {
    const limit = cleanLimit(limitInput, 25, 100);
    const result = await query("select * from life_events where archived_at is null order by occurred_at desc limit $1", [limit]);
    return result.rows.map(eventFromRow);
  }

  async recall(queryText: string, limitInput: unknown = 10): Promise<RecallResult[]> {
    const limit = cleanLimit(limitInput, 10, 50);
    const result = await query(
      `with keyword as (
         select *, ts_rank_cd(search_vector, plainto_tsquery('simple', $1)) as score, 'keyword'::text as match_kind
         from life_events
         where archived_at is null and search_vector @@ plainto_tsquery('simple', $1)
       ), fuzzy as (
         select *, greatest(similarity(title, $1), similarity(coalesce(summary, ''), $1), similarity(coalesce(body, ''), $1)) as score, 'fuzzy'::text as match_kind
         from life_events
         where archived_at is null
           and (
             title ilike '%' || $1 || '%'
             or coalesce(summary, '') ilike '%' || $1 || '%'
             or coalesce(body, '') ilike '%' || $1 || '%'
             or similarity(title, $1) > 0.08
             or similarity(coalesce(summary, ''), $1) > 0.05
           )
       ), combined as (
         select distinct on (id) * from (
           select * from keyword
           union all
           select * from fuzzy
         ) matches
         order by id, score desc
       )
       select * from combined
       order by score desc, occurred_at desc
       limit $2`,
      [queryText, limit]
    );
    return result.rows.map((row) => ({
      event: eventFromRow(row),
      matchKind: row.match_kind === "keyword" ? "keyword" : "fuzzy",
      score: Number(row.score ?? 0),
      reason: row.match_kind === "keyword" ? "Matched full-text keyword search." : "Matched fuzzy text search."
    }));
  }

  async timeline(topic: string, limitInput: unknown = 100): Promise<LifeArchiveEvent[]> {
    const limit = cleanLimit(limitInput, 100, 250);
    const result = await query(
      `select * from life_events
       where archived_at is null
         and (
           search_vector @@ plainto_tsquery('simple', $1)
           or title ilike '%' || $1 || '%'
           or coalesce(summary, '') ilike '%' || $1 || '%'
           or coalesce(body, '') ilike '%' || $1 || '%'
           or metadata->>'project' ilike '%' || $1 || '%'
         )
       order by occurred_at asc
       limit $2`,
      [topic, limit]
    );
    return result.rows.map(eventFromRow);
  }

  async capture(input: Record<string, unknown>): Promise<LifeArchiveEvent> {
    const id = `life_evt_${randomUUID().replaceAll("-", "")}`;
    const metadata = { ...((typeof input.metadata === "object" && input.metadata !== null && !Array.isArray(input.metadata)) ? input.metadata as Record<string, unknown> : {}) };
    if (typeof input.project === "string" && input.project.trim()) metadata.project = input.project.trim();

    const result = await query(
      `insert into life_events (
        id, occurred_at, type, sensitivity, title, summary, body, confidence,
        created_by_profile, session_id, platform, source_kind, metadata
      ) values ($1, coalesce($2::timestamptz, now()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      returning *`,
      [
        id,
        typeof input.occurredAt === "string" ? input.occurredAt : typeof input.occurred_at === "string" ? input.occurred_at : null,
        typeof input.type === "string" ? input.type : "event",
        typeof input.sensitivity === "string" ? input.sensitivity : "personal",
        typeof input.title === "string" ? input.title : "Untitled remote MCP event",
        typeof input.summary === "string" ? input.summary : null,
        typeof input.body === "string" ? input.body : null,
        typeof input.confidence === "string" ? input.confidence : "agent_inferred",
        typeof input.createdByProfile === "string" ? input.createdByProfile : "remote_agent",
        typeof input.sessionId === "string" ? input.sessionId : null,
        typeof input.platform === "string" ? input.platform : "remote_mcp",
        typeof input.sourceKind === "string" ? input.sourceKind : "manual_note",
        JSON.stringify(metadata)
      ]
    );
    return eventFromRow(result.rows[0]!);
  }
}
