import { createHermesId } from "../core/ids.js";
import type { ExternalRef, ExternalSystem, SyncDirection } from "../core/types.js";
import { query } from "./client.js";

function externalRefFromRow(row: Record<string, unknown>): ExternalRef {
  return {
    id: row.id as string,
    hermesObjectType: row.hermes_object_type as ExternalRef["hermesObjectType"],
    hermesObjectId: row.hermes_object_id as string,
    system: row.system as ExternalSystem,
    externalId: row.external_id as string,
    externalUrl: (row.external_url as string | null) ?? null,
    syncDirection: row.sync_direction as SyncDirection,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : null,
    metadata: (row.metadata as Record<string, unknown>) ?? {}
  };
}

export class ExternalRefRepository {
  async upsert(input: {
    hermesObjectType: ExternalRef["hermesObjectType"];
    hermesObjectId: string;
    system: ExternalSystem;
    externalId: string;
    externalUrl?: string | null;
    syncDirection: SyncDirection;
    metadata?: Record<string, unknown>;
  }): Promise<ExternalRef> {
    const result = await query(
      `insert into external_refs (
        id, hermes_object_type, hermes_object_id, system, external_id, external_url, sync_direction, last_synced_at, metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, now(), $8)
      on conflict (system, external_id)
      do update set
        hermes_object_type = excluded.hermes_object_type,
        hermes_object_id = excluded.hermes_object_id,
        external_url = excluded.external_url,
        sync_direction = excluded.sync_direction,
        last_synced_at = now(),
        metadata = excluded.metadata
      returning *`,
      [
        createHermesId("xref"),
        input.hermesObjectType,
        input.hermesObjectId,
        input.system,
        input.externalId,
        input.externalUrl ?? null,
        input.syncDirection,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return externalRefFromRow(result.rows[0]!);
  }

  async findByExternal(system: ExternalSystem, externalId: string): Promise<ExternalRef | null> {
    const result = await query("select * from external_refs where system = $1 and external_id = $2", [system, externalId]);
    return result.rows[0] ? externalRefFromRow(result.rows[0]) : null;
  }
}
