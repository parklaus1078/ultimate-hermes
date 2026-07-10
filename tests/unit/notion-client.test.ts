import { afterEach, describe, expect, it, vi } from "vitest";
import { NotionClient } from "../../src/adapters/notion/client.js";
import { MemorySecretStore } from "../../src/secrets/memory-secret-store.js";

describe("NotionClient", () => {
  afterEach(() => {
    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_API_TOKEN;
    vi.restoreAllMocks();
  });

  it("falls back to NOTION_API_KEY when keychain token is absent", async () => {
    process.env.NOTION_API_KEY = "ntn_env_token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
    );

    const result = await new NotionClient(new MemorySecretStore()).search("Hermes");

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer ntn_env_token");
  });
});
