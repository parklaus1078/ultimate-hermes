import { createSourceId } from "./ids.js";
import type { CreateSourceInput, HermesSource } from "./types.js";
import { query } from "../db/client.js";
import { sourceFromRow } from "../db/rows.js";

export class SourceRepository {
  async create(input: CreateSourceInput): Promise<HermesSource> {
    const result = await query(
      `insert into sources (id, event_id, kind, source_uri, external_id, sha256, metadata)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning *`,
      [
        createSourceId(),
        input.eventId,
        input.kind,
        input.sourceUri,
        input.externalId ?? null,
        input.sha256 ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return sourceFromRow(result.rows[0]!);
  }

  async listForEvent(eventId: string): Promise<HermesSource[]> {
    const result = await query("select * from sources where event_id = $1 order by captured_at asc", [eventId]);
    return result.rows.map(sourceFromRow);
  }
}
