export type EventType =
  | "project"
  | "ticket"
  | "document"
  | "decision"
  | "incident"
  | "legal"
  | "career"
  | "purchase"
  | "research"
  | "communication"
  | "system";

export type Sensitivity = "public" | "personal" | "confidential" | "legal_sensitive";

export type Confidence = "human_confirmed" | "imported" | "agent_inferred";

export type SourceKind =
  | "file"
  | "url"
  | "email"
  | "linear_issue"
  | "notion_page"
  | "github_commit"
  | "github_pr"
  | "calendar_event"
  | "manual_note"
  | "google_drive_file"
  | "gmail_message";

export type EntityType =
  | "person"
  | "organization"
  | "project"
  | "ticket"
  | "document"
  | "decision"
  | "incident"
  | "evidence"
  | "repository"
  | "service";

export type ExternalSystem =
  | "linear"
  | "notion"
  | "google_calendar"
  | "gmail"
  | "google_drive"
  | "github";

export type SyncDirection = "imported" | "exported" | "bidirectional";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "executed";

export type AgentRunStatus = "running" | "succeeded" | "failed";

export type HermesEvent = {
  id: string;
  occurredAt: Date;
  type: EventType;
  sensitivity: Sensitivity;
  title: string;
  summary: string | null;
  body: string | null;
  confidence: Confidence;
  createdByProfile: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type CreateEventInput = {
  type: EventType;
  sensitivity: Sensitivity;
  title: string;
  summary?: string | null;
  body?: string | null;
  confidence?: Confidence;
  occurredAt?: Date;
  createdByProfile: string;
  metadata?: Record<string, unknown>;
};

export type HermesSource = {
  id: string;
  eventId: string;
  kind: SourceKind;
  sourceUri: string;
  externalId: string | null;
  sha256: string | null;
  capturedAt: Date;
  metadata: Record<string, unknown>;
};

export type CreateSourceInput = {
  eventId: string;
  kind: SourceKind;
  sourceUri: string;
  externalId?: string | null;
  sha256?: string | null;
  metadata?: Record<string, unknown>;
};

export type HermesEntity = {
  id: string;
  type: EntityType;
  name: string;
  aliases: string[];
  sensitivity: Sensitivity;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type ExternalRef = {
  id: string;
  hermesObjectType: "event" | "entity" | "source";
  hermesObjectId: string;
  system: ExternalSystem;
  externalId: string;
  externalUrl: string | null;
  syncDirection: SyncDirection;
  lastSyncedAt: Date | null;
  metadata: Record<string, unknown>;
};

export type RecallMatchKind = "exact" | "fuzzy" | "semantic";

export type RecallResult = {
  event: HermesEvent;
  matchKind: RecallMatchKind;
  score: number;
  reason: string;
};
