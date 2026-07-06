import type { HermesEvent, RecallResult } from "../core/types.js";
import { query } from "../db/client.js";
import { EventRepository } from "../db/events.js";
import { eventFromRow } from "../db/rows.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { EmbeddingRepository } from "./embeddings.js";

export class RecallService {
  constructor(
    private readonly events = new EventRepository(),
    private readonly embeddingProvider?: EmbeddingProvider
  ) {}

  async remember(input: { queryText: string; limit?: number }): Promise<RecallResult[]> {
    const limit = input.limit ?? 10;
    const exact = await this.exactAndFuzzy(input.queryText, limit);
    const semantic = this.embeddingProvider ? await this.semantic(input.queryText, limit) : [];

    const byEvent = new Map<string, RecallResult>();
    for (const item of [...exact, ...semantic]) {
      const existing = byEvent.get(item.event.id);
      if (!existing || item.score > existing.score) byEvent.set(item.event.id, item);
    }
    return [...byEvent.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async timeline(topic: string, limit = 100): Promise<HermesEvent[]> {
    return this.events.listByTopic(topic, limit);
  }

  private async exactAndFuzzy(queryText: string, limit: number): Promise<RecallResult[]> {
    const result = await query(
      `with q as (select plainto_tsquery('simple', $1) as tsq)
       select e.*,
              greatest(
                coalesce(ts_rank_cd(e.search_vector, q.tsq), 0),
                similarity(e.title, $1),
                similarity(coalesce(e.summary, ''), $1)
              ) as score,
              case when e.search_vector @@ q.tsq then 'exact' else 'fuzzy' end as match_kind
       from events e, q
       where e.archived_at is null
         and (
           e.search_vector @@ q.tsq
           or similarity(e.title, $1) > 0.12
           or similarity(coalesce(e.summary, ''), $1) > 0.12
           or e.title ilike '%' || $1 || '%'
           or coalesce(e.summary, '') ilike '%' || $1 || '%'
           or coalesce(e.body, '') ilike '%' || $1 || '%'
         )
       order by score desc, e.occurred_at desc
       limit $2`,
      [queryText, limit]
    );

    return result.rows.map((row) => ({
      event: eventFromRow(row),
      matchKind: row.match_kind as "exact" | "fuzzy",
      score: Number(row.score),
      reason: row.match_kind === "exact" ? "Matched full-text search." : "Matched fuzzy/partial text search."
    }));
  }

  private async semantic(queryText: string, limit: number): Promise<RecallResult[]> {
    if (!this.embeddingProvider) return [];
    const matches = await new EmbeddingRepository(this.embeddingProvider).search(queryText, { limit });
    const results: RecallResult[] = [];
    for (const match of matches) {
      if (match.hermesObjectType !== "event") continue;
      const event = await this.events.getById(match.hermesObjectId);
      if (!event || event.archivedAt) continue;
      results.push({
        event,
        matchKind: "semantic",
        score: match.score,
        reason: "Matched pgvector semantic similarity."
      });
    }
    return results;
  }
}
