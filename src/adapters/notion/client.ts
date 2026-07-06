import { loadConfig } from "../../config/env.js";
import type { SecretStore } from "../../secrets/secret-store.js";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export class NotionClient {
  constructor(private readonly secretStore: SecretStore) {}

  private async token(): Promise<string> {
    const config = loadConfig();
    const token = await this.secretStore.get(config.keychain.notion.service, config.keychain.notion.account);
    if (!token) {
      throw new Error(`Missing Notion API key in ${this.secretStore.describe()} service=${config.keychain.notion.service} account=${config.keychain.notion.account}`);
    }
    return token;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${NOTION_API_BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.token()}`,
        "content-type": "application/json",
        "notion-version": NOTION_VERSION,
        ...init.headers
      }
    });

    if (!response.ok) {
      throw new Error(`Notion API failed: ${response.status} ${await response.text()}`);
    }
    return await response.json() as T;
  }

  async search(query = "Hermes"): Promise<unknown> {
    return this.request("/search", {
      method: "POST",
      body: JSON.stringify({ query, page_size: 10 })
    });
  }

  async createPage(input: { parentPageId: string; title: string; body?: string }): Promise<{ id: string; url?: string }> {
    return this.request<{ id: string; url?: string }>("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { page_id: input.parentPageId },
        properties: {
          title: {
            title: [{ text: { content: input.title } }]
          }
        },
        children: input.body
          ? [
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: [{ type: "text", text: { content: input.body.slice(0, 1800) } }]
                }
              }
            ]
          : []
      })
    });
  }

  async createDatabase(input: { parentPageId: string; title: string; properties: Record<string, unknown> }): Promise<{ id: string; url?: string }> {
    return this.request<{ id: string; url?: string }>("/databases", {
      method: "POST",
      body: JSON.stringify({
        parent: { page_id: input.parentPageId },
        title: [{ type: "text", text: { content: input.title } }],
        properties: input.properties
      })
    });
  }
}
