import { createHash, randomUUID } from "node:crypto";
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
  matchKind: "recent" | "keyword" | "fuzzy" | "semantic" | "keyword+semantic" | "fuzzy+semantic";
  score: number;
  reason: string;
};

export type RecallOptions = {
  limit?: unknown;
  eventType?: string;
  sensitivity?: string;
  project?: string;
  sessionId?: string;
  embedding?: number[];
  embeddingModel?: string;
};

const eventTypes = new Set([
  "project",
  "ticket",
  "document",
  "decision",
  "incident",
  "legal",
  "career",
  "purchase",
  "research",
  "communication",
  "system",
  "source",
  "project_update",
  "event"
]);
const sensitivities = new Set(["public", "personal", "confidential", "legal_sensitive"]);
const confidenceLevels = new Set(["human_confirmed", "imported", "agent_inferred"]);

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

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}\n[truncated]` : normalized;
}

function cleanEnum(value: unknown, allowed: Set<string>, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? value.toFixed(8) : "0")).join(",")}]`;
}

function embeddingText(event: LifeArchiveEvent): string {
  return [
    `Title: ${event.title}`,
    `Type: ${event.type}`,
    `Summary: ${event.summary ?? ""}`,
    `Body: ${event.body ?? ""}`
  ].join("\n");
}

function mergeRecall(primary: RecallResult[], semantic: RecallResult[], limit: number): RecallResult[] {
  const merged = new Map<string, RecallResult>();
  for (const item of primary) merged.set(item.event.id, item);
  for (const item of semantic) {
    const existing = merged.get(item.event.id);
    if (!existing) {
      merged.set(item.event.id, item);
      continue;
    }
    const matchKind = existing.matchKind === "keyword" ? "keyword+semantic" : existing.matchKind === "fuzzy" ? "fuzzy+semantic" : existing.matchKind;
    merged.set(item.event.id, {
      ...existing,
      matchKind,
      score: Math.max(existing.score, item.score),
      reason: `${existing.reason} Also matched pgvector semantic similarity.`
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score || b.event.occurredAt.getTime() - a.event.occurredAt.getTime()).slice(0, limit);
}

export class LifeArchiveRepository {
  async recent(limitInput: unknown = 25): Promise<LifeArchiveEvent[]> {
    const limit = cleanLimit(limitInput, 25, 100);
    const result = await query("select * from life_events where archived_at is null order by occurred_at desc limit $1", [limit]);
    return result.rows.map(eventFromRow);
  }

  async recall(queryText: string, options: RecallOptions = {}): Promise<RecallResult[]> {
    const normalizedQuery = cleanText(queryText, 1_000);
    const limit = cleanLimit(options.limit, 10, 50);
    if (!normalizedQuery && !options.project) {
      return (await this.recent(limit)).map((event) => ({
        event,
        matchKind: "recent",
        score: 0.1,
        reason: "Returned as a recent durable event."
      }));
    }

    const params: unknown[] = [normalizedQuery];
    const filters = ["e.archived_at is null"];
    if (options.eventType) {
      params.push(options.eventType);
      filters.push(`e.type = $${params.length}`);
    }
    if (options.sensitivity) {
      params.push(options.sensitivity);
      filters.push(`e.sensitivity = $${params.length}`);
    }
    if (options.project) {
      params.push(`%${options.project}%`);
      filters.push(`(e.metadata->>'project' ilike $${params.length} or e.title ilike $${params.length} or coalesce(e.summary, '') ilike $${params.length})`);
    }
    params.push(limit);

    const keywordResult = await query(
      `with q as (select plainto_tsquery('simple', $1) as tsq)
       select e.*,
              greatest(
                coalesce(ts_rank_cd(e.search_vector, q.tsq), 0),
                similarity(e.title, $1),
                similarity(coalesce(e.summary, ''), $1)
              )::double precision as score,
              case when e.search_vector @@ q.tsq then 'keyword' else 'fuzzy' end as match_kind
       from life_events e, q
       where ${filters.join(" and ")}
         and (
           e.search_vector @@ q.tsq
           or similarity(e.title, $1) > 0.12
           or similarity(coalesce(e.summary, ''), $1) > 0.12
           or e.title ilike ('%' || $1 || '%')
           or coalesce(e.summary, '') ilike ('%' || $1 || '%')
           or coalesce(e.body, '') ilike ('%' || $1 || '%')
         )
       order by score desc, e.occurred_at desc
       limit $${params.length}`,
      params
    );
    const primary: RecallResult[] = keywordResult.rows.map((row) => ({
      event: eventFromRow(row),
      matchKind: row.match_kind === "keyword" ? "keyword" : "fuzzy",
      score: Number(row.score ?? 0),
      reason: row.match_kind === "keyword" ? "Matched Postgres full-text search." : "Matched fuzzy text search."
    }));

    const semantic = options.embedding && options.embeddingModel
      ? await this.semanticRecall(options.embedding, options.embeddingModel, {
          limit,
          eventType: options.eventType,
          sensitivity: options.sensitivity,
          project: options.project
        })
      : [];
    const merged = mergeRecall(primary, semantic, limit);
    if (normalizedQuery && merged.length > 0) await this.recordRecallHits(normalizedQuery, merged, options.sessionId ?? "");
    return merged;
  }

  private async semanticRecall(embedding: number[], embeddingModel: string, options: RecallOptions): Promise<RecallResult[]> {
    const limit = cleanLimit(options.limit, 10, 50);
    const params: unknown[] = [vectorLiteral(embedding), embeddingModel];
    const filters = ["e.archived_at is null", "emb.hermes_object_type = 'event'", "emb.embedding_model = $2"];
    if (options.eventType) {
      params.push(options.eventType);
      filters.push(`e.type = $${params.length}`);
    }
    if (options.sensitivity) {
      params.push(options.sensitivity);
      filters.push(`e.sensitivity = $${params.length}`);
    }
    if (options.project) {
      params.push(`%${options.project}%`);
      filters.push(`(e.metadata->>'project' ilike $${params.length} or e.title ilike $${params.length} or coalesce(e.summary, '') ilike $${params.length})`);
    }
    params.push(limit);
    const result = await query(
      `select e.*,
              (1 - (emb.embedding <=> $1::vector))::double precision as score
       from life_embeddings emb
       join life_events e on e.id = emb.hermes_object_id
       where ${filters.join(" and ")}
       order by emb.embedding <=> $1::vector
       limit $${params.length}`,
      params
    );
    return result.rows.map((row) => ({
      event: eventFromRow(row),
      matchKind: "semantic",
      score: Number(row.score ?? 0),
      reason: "Matched pgvector semantic similarity."
    }));
  }

  async timeline(topic: string, options: RecallOptions = {}): Promise<LifeArchiveEvent[]> {
    const results = await this.recall(topic, { ...options, limit: cleanLimit(options.limit, 100, 250) });
    return results.map((item) => item.event).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }

  async capture(input: Record<string, unknown>): Promise<LifeArchiveEvent> {
    const id = `life_evt_${randomUUID().replaceAll("-", "")}`;
    const metadata = {
      ...((typeof input.metadata === "object" && input.metadata !== null && !Array.isArray(input.metadata)) ? input.metadata as Record<string, unknown> : {})
    };
    if (typeof input.project === "string" && input.project.trim()) metadata.project = input.project.trim();
    const title = cleanText(input.title, 500);
    if (!title) throw new Error("title is required");

    const result = await query(
      `insert into life_events (
        id, occurred_at, type, sensitivity, title, summary, body, confidence,
        created_by_profile, session_id, platform, source_kind, metadata
      ) values ($1, coalesce($2::timestamptz, now()), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      returning *`,
      [
        id,
        typeof input.occurredAt === "string" ? input.occurredAt : typeof input.occurred_at === "string" ? input.occurred_at : null,
        cleanEnum(input.type, eventTypes, "event"),
        cleanEnum(input.sensitivity, sensitivities, "personal"),
        title,
        cleanText(input.summary, 4_000) || null,
        cleanText(input.body, 20_000) || null,
        cleanEnum(input.confidence, confidenceLevels, "agent_inferred"),
        cleanText(input.createdByProfile, 200) || "remote_agent",
        cleanText(input.sessionId, 500) || null,
        cleanText(input.platform, 100) || "remote_mcp",
        cleanText(input.sourceKind, 100) || "manual_note",
        JSON.stringify(metadata)
      ]
    );
    return eventFromRow(result.rows[0]!);
  }

  async linkSource(input: { eventId: string; kind: string; sourceUri: string; externalId?: string; sha256?: string; metadata?: Record<string, unknown> }) {
    const id = `life_src_${randomUUID().replaceAll("-", "")}`;
    const result = await query(
      `insert into life_sources (id, event_id, kind, source_uri, external_id, sha256, metadata)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, event_id, kind, source_uri, external_id, sha256, captured_at, metadata`,
      [id, input.eventId, input.kind, input.sourceUri, input.externalId || null, input.sha256 || null, JSON.stringify(input.metadata ?? {})]
    );
    return result.rows[0]!;
  }

  async projectStatus(project: string, limitInput: unknown = 20) {
    const limit = cleanLimit(limitInput, 20, 100);
    const recalled = await this.recall(project, { project, limit });
    const countsByType: Record<string, number> = {};
    const possibleBlockers: LifeArchiveEvent[] = [];
    for (const item of recalled) {
      countsByType[item.event.type] = (countsByType[item.event.type] ?? 0) + 1;
      const text = JSON.stringify(item.event);
      if (/\b(blocked|blocker|waiting|stalled)\b|막힘|블로커|대기/i.test(text)) possibleBlockers.push(item.event);
    }
    return {
      project,
      eventCount: recalled.length,
      countsByType,
      recentEvents: recalled.map((item) => item.event),
      possibleBlockers: possibleBlockers.slice(0, 5)
    };
  }

  async memoryStatus() {
    const result = await query(
      `select
         (select count(*)::bigint from life_events where archived_at is null) as active_events,
         (select count(*)::bigint from life_sources) as sources,
         (select count(*)::bigint from life_external_refs) as external_refs,
         (select count(*)::bigint from life_embeddings) as embeddings,
         (select extversion from pg_extension where extname = 'vector') as vector_version`
    );
    const row = result.rows[0]!;
    return {
      sourceTable: "life_events",
      activeEvents: Number(row.active_events),
      sources: Number(row.sources),
      externalRefs: Number(row.external_refs),
      embeddings: Number(row.embeddings),
      pgvector: row.vector_version ? String(row.vector_version) : null
    };
  }

  async upsertEmbedding(event: LifeArchiveEvent, model: string, embedding: number[]): Promise<void> {
    const content = embeddingText(event);
    const contentHash = createHash("sha256").update(content).digest("hex");
    await query(
      `insert into life_embeddings (
         id, hermes_object_type, hermes_object_id, embedding_model,
         embedding, content_hash, sensitivity
       ) values ($1, 'event', $2, $3, $4::vector, $5, $6)
       on conflict (hermes_object_type, hermes_object_id, embedding_model, content_hash)
       do update set embedding = excluded.embedding, sensitivity = excluded.sensitivity, created_at = now()`,
      [`life_emb_${randomUUID().replaceAll("-", "")}`, event.id, model, vectorLiteral(embedding), contentHash, event.sensitivity]
    );
    await query(
      `delete from life_embeddings
       where hermes_object_type = 'event' and hermes_object_id = $1
         and embedding_model = $2 and content_hash <> $3`,
      [event.id, model, contentHash]
    );
  }

  private async recordRecallHits(queryText: string, results: RecallResult[], sessionId: string): Promise<void> {
    const values: unknown[] = [];
    const rows = results.map((item, index) => {
      const offset = index * 6;
      values.push(
        `life_hit_${randomUUID().replaceAll("-", "")}`,
        queryText,
        item.event.id,
        item.matchKind,
        item.score,
        sessionId || null
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
    });
    await query(
      `insert into life_recall_hits (id, query, event_id, match_kind, score, session_id)
       values ${rows.join(", ")}`,
      values
    );
  }
}
