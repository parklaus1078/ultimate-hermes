LIFE_CAPTURE_SCHEMA = {
    "name": "life_capture",
    "description": (
        "Save durable personal/project history into the Postgres life archive. "
        "Use for decisions, incidents, project updates, research notes, legal-sensitive "
        "evidence notes, troubleshooting outcomes, and user-confirmed facts. Do not save secrets."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["event", "decision", "source", "incident", "project_update", "legal", "research"],
                "description": "Kind of history being captured.",
            },
            "title": {"type": "string", "description": "Short durable title."},
            "summary": {"type": "string", "description": "Concise summary."},
            "body": {"type": "string", "description": "Detailed note, evidence, or context."},
            "project": {"type": "string", "description": "Optional project/workstream name."},
            "sensitivity": {
                "type": "string",
                "enum": ["public", "personal", "confidential", "legal_sensitive"],
                "description": "Sensitivity classification.",
            },
            "confidence": {
                "type": "string",
                "enum": ["human_confirmed", "imported", "agent_inferred"],
                "description": "How certain/provenanced this record is.",
            },
            "occurred_at": {"type": "string", "description": "Optional ISO timestamp."},
            "source_uri": {"type": "string", "description": "Optional raw source URI/path/URL."},
            "external_system": {"type": "string", "description": "Optional external system name, e.g. linear/notion/gmail."},
            "external_id": {"type": "string", "description": "Optional external object ID."},
            "external_url": {"type": "string", "description": "Optional external object URL."},
        },
        "required": ["action", "title"],
    },
}

LIFE_RECALL_SCHEMA = {
    "name": "life_recall",
    "description": (
        "Recall durable personal/project history from the Postgres life archive. "
        "Use before answering questions about past decisions, project history, documents, "
        "incidents, legal-sensitive timelines, troubleshooting, or user preferences."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Natural language recall query."},
            "type": {"type": "string", "description": "Optional event type filter."},
            "project": {"type": "string", "description": "Optional project/workstream filter."},
            "sensitivity": {"type": "string", "description": "Optional sensitivity filter."},
            "limit": {"type": "integer", "description": "Max results, default 10."},
        },
        "required": ["query"],
    },
}

LIFE_TIMELINE_SCHEMA = {
    "name": "life_timeline",
    "description": "Build a chronological timeline for a project, incident, dispute, decision, or topic.",
    "parameters": {
        "type": "object",
        "properties": {
            "topic": {"type": "string", "description": "Topic to reconstruct."},
            "project": {"type": "string", "description": "Optional project/workstream filter."},
            "limit": {"type": "integer", "description": "Max timeline events, default 50."},
        },
        "required": ["topic"],
    },
}

LIFE_LINK_SOURCE_SCHEMA = {
    "name": "life_link_source",
    "description": "Attach a raw source/evidence reference to an existing life_archive event.",
    "parameters": {
        "type": "object",
        "properties": {
            "event_id": {"type": "string", "description": "life_event ID."},
            "kind": {"type": "string", "description": "file/url/email/linear_issue/notion_page/calendar_event/etc."},
            "source_uri": {"type": "string", "description": "Path, URL, or source URI."},
            "external_id": {"type": "string", "description": "Optional external ID."},
            "sha256": {"type": "string", "description": "Optional source hash."},
        },
        "required": ["event_id", "kind", "source_uri"],
    },
}

LIFE_PROJECT_STATUS_SCHEMA = {
    "name": "life_project_status",
    "description": "Summarize current and historical project state from durable memory.",
    "parameters": {
        "type": "object",
        "properties": {
            "project": {"type": "string", "description": "Project/workstream name."},
            "limit": {"type": "integer", "description": "Max recent events, default 20."},
        },
        "required": ["project"],
    },
}

TOOL_SCHEMAS = [
    LIFE_CAPTURE_SCHEMA,
    LIFE_RECALL_SCHEMA,
    LIFE_TIMELINE_SCHEMA,
    LIFE_LINK_SOURCE_SCHEMA,
    LIFE_PROJECT_STATUS_SCHEMA,
]

