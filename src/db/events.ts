import { createEventId } from "../core/ids.js";
import type { CreateEventInput, HermesEvent } from "../core/types.js";
import { query } from "./client.js";
import { eventFromRow } from "./rows.js";

export class EventRepository {
  async create(input: CreateEventInput): Promise<HermesEvent> {
    const id = createEventId();
    const result = await query(
      `insert into events (
        id, occurred_at, type, sensitivity, title, summary, body, confidence, created_by_profile, metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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

  async getById(id: string): Promise<HermesEvent | null> {
    const result = await query("select * from events where id = $1", [id]);
    return result.rows[0] ? eventFromRow(result.rows[0]) : null;
  }

  async archive(id: string): Promise<HermesEvent | null> {
    const result = await query("update events set archived_at = now(), updated_at = now() where id = $1 returning *", [id]);
    return result.rows[0] ? eventFromRow(result.rows[0]) : null;
  }

  async listRecent(limit = 25): Promise<HermesEvent[]> {
    const result = await query("select * from events where archived_at is null order by occurred_at desc limit $1", [limit]);
    return result.rows.map(eventFromRow);
  }

  async listSince(since: Date): Promise<HermesEvent[]> {
    const result = await query("select * from events where occurred_at >= $1 and archived_at is null order by occurred_at asc", [since]);
    return result.rows.map(eventFromRow);
  }

  async listByTopic(topic: string, limit = 50): Promise<HermesEvent[]> {
    const result = await query(
      `select * from events
       where archived_at is null
         and (
           search_vector @@ plainto_tsquery('simple', $1)
           or title ilike '%' || $1 || '%'
           or summary ilike '%' || $1 || '%'
           or body ilike '%' || $1 || '%'
         )
       order by occurred_at asc
       limit $2`,
      [topic, limit]
    );
    return result.rows.map(eventFromRow);
  }
}
