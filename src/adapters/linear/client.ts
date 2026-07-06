import { loadConfig } from "../../config/env.js";
import type { SecretStore } from "../../secrets/secret-store.js";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url?: string;
  updatedAt?: string;
  state?: { id: string; name: string };
  project?: { id: string; name: string } | null;
};

export class LinearClient {
  constructor(private readonly secretStore: SecretStore) {}

  private async token(): Promise<string> {
    const config = loadConfig();
    const token = await this.secretStore.get(config.keychain.linear.service, config.keychain.linear.account);
    if (!token) {
      throw new Error(`Missing Linear API key in ${this.secretStore.describe()} service=${config.keychain.linear.service} account=${config.keychain.linear.account}`);
    }
    return token;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(LINEAR_GRAPHQL_URL, {
      method: "POST",
      headers: {
        authorization: await this.token(),
        "content-type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });

    const payload = await response.json() as { data?: T; errors?: Array<{ message: string }> };
    if (!response.ok || payload.errors?.length) {
      throw new Error(`Linear GraphQL failed: ${response.status} ${payload.errors?.map((item) => item.message).join("; ") ?? ""}`);
    }
    if (!payload.data) throw new Error("Linear returned no data");
    return payload.data;
  }

  async viewer(): Promise<{ id: string; name: string; email: string }> {
    const data = await this.graphql<{ viewer: { id: string; name: string; email: string } }>(
      `query HermesViewer { viewer { id name email } }`
    );
    return data.viewer;
  }

  async listIssues(first = 50): Promise<LinearIssue[]> {
    const data = await this.graphql<{ issues: { nodes: LinearIssue[] } }>(
      `query HermesIssues($first: Int!) {
        issues(first: $first, orderBy: updatedAt) {
          nodes {
            id identifier title description url updatedAt
            state { id name }
            project { id name }
          }
        }
      }`,
      { first }
    );
    return data.issues.nodes;
  }

  async createIssue(input: { teamId: string; title: string; description?: string; projectId?: string }): Promise<LinearIssue> {
    const data = await this.graphql<{ issueCreate: { success: boolean; issue: LinearIssue } }>(
      `mutation HermesIssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier title url updatedAt state { id name } project { id name } }
        }
      }`,
      {
        input: {
          teamId: input.teamId,
          projectId: input.projectId,
          title: input.title,
          description: input.description
        }
      }
    );
    if (!data.issueCreate.success) throw new Error("Linear issueCreate returned success=false");
    return data.issueCreate.issue;
  }
}
