export const notionDatabasePlan = [
  "Documents",
  "Decisions",
  "Incidents",
  "Evidence",
  "People",
  "Organizations",
  "Projects"
] as const;

export type NotionDatabaseName = typeof notionDatabasePlan[number];

export function describeNotionDatabasePlan(): string {
  return notionDatabasePlan.map((name) => `- ${name}`).join("\n");
}

export function databasePropertiesFor(name: NotionDatabaseName): Record<string, unknown> {
  const common = {
    "Hermes ID": { rich_text: {} },
    Type: { select: { options: [] } },
    Sensitivity: { select: { options: [] } },
    Summary: { rich_text: {} },
    "Source URL": { url: {} },
    "Occurred At": { date: {} }
  };

  if (name === "People" || name === "Organizations") {
    return {
      Name: { title: {} },
      Aliases: { multi_select: { options: [] } },
      Notes: { rich_text: {} },
      "Hermes ID": { rich_text: {} }
    };
  }

  return {
    Name: { title: {} },
    ...common,
    Status: { select: { options: [] } },
    Tags: { multi_select: { options: [] } }
  };
}

export function documentsDatabasePayload(parentPageId: string) {
  return {
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "Hermes Documents" } }],
    properties: {
      Name: { title: {} },
      "Hermes ID": { rich_text: {} },
      Type: { select: { options: [{ name: "document" }, { name: "research" }, { name: "legal" }] } },
      Sensitivity: { select: { options: [{ name: "personal" }, { name: "confidential" }, { name: "legal_sensitive" }] } },
      Source: { url: {} },
      Captured: { date: {} }
    }
  };
}

export function decisionsDatabasePayload(parentPageId: string) {
  return {
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "Hermes Decisions" } }],
    properties: {
      Name: { title: {} },
      "Hermes ID": { rich_text: {} },
      Sensitivity: { select: { options: [{ name: "personal" }, { name: "confidential" }, { name: "legal_sensitive" }] } },
      Status: { select: { options: [{ name: "active" }, { name: "revisit" }, { name: "superseded" }] } },
      Date: { date: {} }
    }
  };
}
