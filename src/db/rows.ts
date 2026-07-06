import type { HermesEvent, HermesSource } from "../core/types.js";

export function eventFromRow(row: Record<string, unknown>): HermesEvent {
  return {
    id: row.id as string,
    occurredAt: new Date(row.occurred_at as string),
    type: row.type as HermesEvent["type"],
    sensitivity: row.sensitivity as HermesEvent["sensitivity"],
    title: row.title as string,
    summary: (row.summary as string | null) ?? null,
    body: (row.body as string | null) ?? null,
    confidence: row.confidence as HermesEvent["confidence"],
    createdByProfile: row.created_by_profile as string,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    archivedAt: row.archived_at ? new Date(row.archived_at as string) : null
  };
}

export function sourceFromRow(row: Record<string, unknown>): HermesSource {
  return {
    id: row.id as string,
    eventId: row.event_id as string,
    kind: row.kind as HermesSource["kind"],
    sourceUri: row.source_uri as string,
    externalId: (row.external_id as string | null) ?? null,
    sha256: (row.sha256 as string | null) ?? null,
    capturedAt: new Date(row.captured_at as string),
    metadata: (row.metadata as Record<string, unknown>) ?? {}
  };
}
