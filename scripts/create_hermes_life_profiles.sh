#!/usr/bin/env bash
set -euo pipefail

HERMES="${HERMES_BIN:-/Users/kay/.local/bin/hermes}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROFILES=()

create_profile() {
  local name="$1"
  local description="$2"
  PROFILES+=("$name")

  if "$HERMES" profile show "$name" >/dev/null 2>&1; then
    "$HERMES" profile describe "$name" --text "$description" >/dev/null
    echo "updated: $name"
    return
  fi

  "$HERMES" profile create "$name" --clone --description "$description" >/dev/null
  echo "created: $name"
}

create_profile "chief_of_staff" "Daily operations coordinator for morning briefs, priority triage, schedule review, follow-ups, and cross-project attention management."
create_profile "capture_router" "Fast capture and classification role for notes, links, documents, decisions, incidents, and routing durable memory into life_archive."
create_profile "project_operator" "Project execution operator for Linear, kanban, tickets, milestones, blockers, status reviews, and next-action planning."
create_profile "archivist" "Document and Notion inventory librarian for source provenance, readable summaries, document relationships, and long-term knowledge organization."
create_profile "evidence_curator" "Legal-sensitive and dispute-history curator for fact timelines, source separation, evidence gaps, and careful non-legal-advice summaries."
create_profile "research_librarian" "Research memory librarian for papers, citations, reading notes, technical references, and reusable research context."
create_profile "troubleshooting_scribe" "Incident and troubleshooting scribe for failures, root causes, fixes, runbooks, and regression history."
create_profile "integration_clerk" "SaaS integration clerk for Linear, Notion, Google Workspace, external references, sync health, and import/export bookkeeping."
create_profile "security_officer" "Security and privacy officer for secrets, approval gates, sensitive data policy, credential hygiene, and external-write review."

for profile in "${PROFILES[@]}"; do
  HERMES_HOME="/Users/kay/.hermes/profiles/$profile" \
    "$ROOT_DIR/scripts/install_life_archive.sh" >/dev/null
  echo "life_archive installed: $profile"
  HERMES_HOME="/Users/kay/.hermes/profiles/$profile" \
    "$ROOT_DIR/scripts/install_life_routine_skill.sh" >/dev/null
  echo "life-routine installed: $profile"
done

"$HERMES" profile list
