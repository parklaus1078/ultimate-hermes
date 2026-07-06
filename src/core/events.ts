import { createEventId } from "./ids.js";
import type { CreateEventInput, HermesEvent } from "./types.js";
import { query } from "../db/client.js";
import { eventFromRow } from "../db/rows.js";

export class EventRepository {
  async create(input: CreateEventInput): Promise<HermesEvent> {
    const id = createEventId();
    const result = await query(
      `insert into events (
        id, occurred_at, type, sensitivity, title, summary, body,
        confidence, created_by_profile, metadata
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      returning *`,
      [
        id,
        input.occurredAt ?? new Date(),
        input.type,
        input.sensitivity,
        input.title,
        input.summary ?? null,
        input.body ?? null,
        input.confidence ?? "human_confirmed",
        input.createdByProfile,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return eventFromRow(result.rows[0]!);
  }

  async get(id: string): Promise<HermesEvent | null> {
    const result = await query("select * from events where id = $1", [id]);
    return result.rowCount ? eventFromRow(result.rows[0]!) : null;
  }

  async listRecent(limit = 20): Promise<HermesEvent[]> {
    const result = await query("select * from events where archived_at is null order by occurred_at desc limit $1", [limit]);
    return result.rows.map(eventFromRow);
  }

  async listSince(since: Date, limit = 200): Promise<HermesEvent[]> {
    const result = await query(
      "select * from events where archived_at is null and occurred_at >= $1 order by occurred_at desc limit $2",
      [since, limit]
    );
    return result.rows.map(eventFromRow);
  }

  async archive(id: string): Promise<HermesEvent | null> {
    const result = await query(
      "update events set archived_at = now(), updated_at = now() where id = $1 returning *",
      [id]
    );
    return result.rowCount ? eventFromRow(result.rows[0]!) : null;
  }

  async keywordSearch(queryText: string, limit = 20): Promise<Array<{ event: HermesEvent; score: number; reason: string }>> {
    const result = await query(
      `with q as (select plainto_tsquery('simple', $1) as tsq)
       select events.*,
         ts_rank(events.search_vector, q.tsq) as rank_score,
         greatest(similarity(events.title, $1), similarity(coalesce(events.summary, ''), $1)) as trigram_score
       from events, q
       where archived_at is null
         and (
           events.search_vector @@ q.tsq
           or events.title % $1
           or coalesce(events.summary, '') % $1
         )
       order by (ts_rank(events.search_vector, q.tsq) * 2.0
         + greatest(similarity(events.title, $1), similarity(coalesce(events.summary, ''), $1))) desc,
         occurred_at desc
       limit $2`,
      [queryText, limit]
    );

    return result.rows.map((row) => ({
      event: eventFromRow(row),
      score: Number(row.rank_score ?? 0) + Number(row.trigram_score ?? 0),
      reason: Number(row.rank_score ?? 0) > 0 ? "keyword full-text match" : "fuzzy trigram match"
    }));
  }

  async timeline(topic: string, limit = 100): Promise<HermesEvent[]> {
    const result = await query(
      `with q as (select plainto_tsquery('simple', $1) as tsq)
       select events.*
       from events, q
       where archived_at is null
         and (
           events.search_vector @@ q.tsq
           or events.title % $1
           or coalesce(events.summary, '') % $1
           or coalesce(events.body, '') ilike '%' || $1 || '%'
         )
       order by occurred_at asc
       limit $2`,
      [topic, limit]
    );
    return result.rows.map(eventFromRow);
  }
}
