import { createEntityId } from "./ids.js";
import type { EntityType, Sensitivity } from "./types.js";
import { query } from "../db/client.js";

export type EntityRecord = {
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  sensitivity: Sensitivity;
  metadata: Record<string, unknown>;
};

export class EntityRepository {
  async upsertByName(input: {
    type: EntityType;
    name: string;
    aliases?: string[];
    sensitivity?: Sensitivity;
    metadata?: Record<string, unknown>;
  }): Promise<EntityRecord> {
    const existing = await query("select * from entities where lower(name) = lower($1) and type = $2 limit 1", [
      input.name,
      input.type
    ]);
    if (existing.rowCount) return this.fromRow(existing.rows[0]!);

    const result = await query(
      `insert into entities (id, type, name, aliases, sensitivity, metadata)
       values ($1,$2,$3,$4,$5,$6)
       returning *`,
      [
        createEntityId(),
        input.type,
        input.name,
        JSON.stringify(input.aliases ?? []),
        input.sensitivity ?? "personal",
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return this.fromRow(result.rows[0]!);
  }

  async linkEvent(eventId: string, entityId: string, relation: string): Promise<void> {
    await query(
      `insert into event_entities (event_id, entity_id, relation)
       values ($1,$2,$3)
       on conflict do nothing`,
      [eventId, entityId, relation]
    );
  }

  private fromRow(row: Record<string, unknown>): EntityRecord {
    return {
      id: row.id as string,
      type: row.type as EntityType,
      name: row.name as string,
      aliases: (row.aliases as string[]) ?? [],
      sensitivity: row.sensitivity as Sensitivity,
      metadata: (row.metadata as Record<string, unknown>) ?? {}
    };
  }
}
