import type { Sensitivity } from "./types.js";

export type PolicyAction =
  | "local_event_write"
  | "local_source_write"
  | "local_search"
  | "external_write"
  | "linear_write"
  | "notion_write"
  | "google_write"
  | "email_read"
  | "calendar_read"
  | "export_sensitive"
  | "delete_file"
  | "embedding_generate";

export type PolicyDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
};

export function decidePolicy(action: PolicyAction, sensitivity: Sensitivity = "personal"): PolicyDecision {
  if (action === "delete_file") {
    return { allowed: false, requiresApproval: true, reason: "Physical file deletion is blocked by default." };
  }

  if (action === "embedding_generate" && sensitivity === "legal_sensitive") {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "legal_sensitive records are excluded from embedding generation by default."
    };
  }

  if (sensitivity === "legal_sensitive" && ["external_write", "linear_write", "notion_write", "google_write"].includes(action)) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "legal_sensitive records require explicit approval before external writes."
    };
  }

  if (["external_write", "linear_write", "notion_write", "google_write", "email_read", "calendar_read", "export_sensitive"].includes(action)) {
    return { allowed: false, requiresApproval: true, reason: `${action} requires approval.` };
  }

  return { allowed: true, requiresApproval: false, reason: "Allowed by local Hermes policy." };
}
