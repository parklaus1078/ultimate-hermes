import type { Sensitivity } from "./types.js";

export type AgentProfile = {
  id: string;
  name: string;
  purpose: string;
  canRead: string[];
  canWrite: string[];
  requiresApprovalFor: string[];
  defaultSensitivity: Sensitivity;
};

export const profiles: AgentProfile[] = [
  {
    id: "chief-of-staff",
    name: "Chief of Staff",
    purpose: "Daily operation control, prioritization, missed follow-up detection.",
    canRead: ["ledger", "linear", "notion", "calendar"],
    canWrite: ["ledger"],
    requiresApprovalFor: ["external_write"],
    defaultSensitivity: "personal"
  },
  {
    id: "capture-router",
    name: "Capture Router",
    purpose: "Fast capture, classification, routing, and deduplication.",
    canRead: ["ledger"],
    canWrite: ["ledger", "sources"],
    requiresApprovalFor: ["external_write"],
    defaultSensitivity: "personal"
  },
  {
    id: "project-manager",
    name: "Project Manager",
    purpose: "Project execution memory, blockers, ticket recommendations.",
    canRead: ["ledger", "linear"],
    canWrite: ["ledger"],
    requiresApprovalFor: ["linear_write"],
    defaultSensitivity: "personal"
  },
  {
    id: "linear-sync-manager",
    name: "Linear Sync Manager",
    purpose: "Linear import/export integrity and ID mapping.",
    canRead: ["ledger", "linear"],
    canWrite: ["ledger", "external_refs"],
    requiresApprovalFor: ["linear_write"],
    defaultSensitivity: "personal"
  },
  {
    id: "archivist",
    name: "Archivist",
    purpose: "Document inventory and Notion archive management.",
    canRead: ["ledger", "notion", "files"],
    canWrite: ["ledger", "sources"],
    requiresApprovalFor: ["notion_write"],
    defaultSensitivity: "personal"
  },
  {
    id: "historian",
    name: "Historian",
    purpose: "Timeline reconstruction and gap detection.",
    canRead: ["ledger", "search"],
    canWrite: ["ledger"],
    requiresApprovalFor: ["external_write"],
    defaultSensitivity: "personal"
  },
  {
    id: "decision-analyst",
    name: "Decision Analyst",
    purpose: "Decision records, tradeoffs, and review conditions.",
    canRead: ["ledger"],
    canWrite: ["ledger"],
    requiresApprovalFor: ["external_write"],
    defaultSensitivity: "personal"
  },
  {
    id: "troubleshooting-analyst",
    name: "Troubleshooting Analyst",
    purpose: "Incident and runbook memory.",
    canRead: ["ledger", "sources"],
    canWrite: ["ledger", "sources"],
    requiresApprovalFor: ["external_write"],
    defaultSensitivity: "personal"
  },
  {
    id: "evidence-clerk",
    name: "Evidence Clerk",
    purpose: "Legal-sensitive source preservation and evidence packets.",
    canRead: ["ledger", "sources"],
    canWrite: ["ledger", "sources"],
    requiresApprovalFor: ["external_write", "export_sensitive"],
    defaultSensitivity: "legal_sensitive"
  },
  {
    id: "research-librarian",
    name: "Research Librarian",
    purpose: "Research document memory and citation links.",
    canRead: ["ledger", "sources"],
    canWrite: ["ledger", "sources"],
    requiresApprovalFor: ["external_write"],
    defaultSensitivity: "personal"
  },
  {
    id: "career-curator",
    name: "Career Curator",
    purpose: "Resume, portfolio, and interview artifact extraction.",
    canRead: ["ledger"],
    canWrite: ["ledger"],
    requiresApprovalFor: ["external_write"],
    defaultSensitivity: "personal"
  },
  {
    id: "security-privacy-officer",
    name: "Security & Privacy Officer",
    purpose: "Policy enforcement, audit, sensitivity labels, and redaction.",
    canRead: ["ledger", "audit"],
    canWrite: ["ledger", "audit", "approval_requests"],
    requiresApprovalFor: [],
    defaultSensitivity: "confidential"
  }
];

export function getProfile(id: string): AgentProfile {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) throw new Error(`Unknown Hermes profile: ${id}`);
  return profile;
}
