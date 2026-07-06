import { jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  type: text("type").notNull(),
  sensitivity: text("sensitivity").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  body: text("body"),
  confidence: text("confidence").notNull(),
  createdByProfile: text("created_by_profile").notNull(),
  metadata: jsonb("metadata").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true })
});

export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  kind: text("kind").notNull(),
  sourceUri: text("source_uri").notNull(),
  externalId: text("external_id"),
  sha256: text("sha256"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").notNull()
});

export const entities = pgTable("entities", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  aliases: jsonb("aliases").notNull(),
  sensitivity: text("sensitivity").notNull(),
  metadata: jsonb("metadata").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const externalRefs = pgTable(
  "external_refs",
  {
    id: text("id").primaryKey(),
    hermesObjectType: text("hermes_object_type").notNull(),
    hermesObjectId: text("hermes_object_id").notNull(),
    system: text("system").notNull(),
    externalId: text("external_id").notNull(),
    externalUrl: text("external_url"),
    syncDirection: text("sync_direction").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull()
  },
  (table) => [uniqueIndex("external_refs_system_external_id_idx").on(table.system, table.externalId)]
);
