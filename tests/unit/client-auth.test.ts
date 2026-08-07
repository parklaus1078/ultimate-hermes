import { describe, expect, it, vi } from "vitest";
import type { McpClient } from "../../src/db/mcp-clients.js";
import { authenticateToken } from "../../src/remote/auth.js";
import { createClientCredential } from "../../src/remote/client-credentials.js";

function storedClient(keyId: string, keyHash: string): McpClient {
  return {
    id: "mcpcli_test",
    keyId,
    keyHash,
    label: "studio-mac-codex",
    deviceName: "studio-mac",
    agentType: "codex",
    status: "active",
    canManageClients: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSeenAt: null,
    revokedAt: null
  };
}

describe("MCP client authentication", () => {
  it("maps a valid key to its device and agent identity", async () => {
    const credential = createClientCredential();
    const lookup = vi.fn(async () => storedClient(credential.id, credential.hash));
    const result = await authenticateToken(
      credential.value,
      { apiToken: "legacy", acceptLegacyApiToken: true },
      lookup
    );
    expect(lookup).toHaveBeenCalledWith(credential.id);
    expect(result).toMatchObject({
      id: "mcpcli_test",
      label: "studio-mac-codex",
      deviceName: "studio-mac",
      agentType: "codex",
      authentication: "client-key"
    });
  });

  it("rejects a key when its hash does not match the stored device key", async () => {
    const credential = createClientCredential();
    const other = createClientCredential();
    const result = await authenticateToken(
      credential.value,
      { apiToken: null, acceptLegacyApiToken: true },
      async () => storedClient(credential.id, other.hash)
    );
    expect(result).toBeNull();
  });

  it("keeps the legacy token as an explicit rollout switch", async () => {
    const lookup = vi.fn();
    await expect(
      authenticateToken("legacy", { apiToken: "legacy", acceptLegacyApiToken: true }, lookup)
    ).resolves.toMatchObject({ authentication: "legacy-token", canManageClients: true });
    await expect(
      authenticateToken("legacy", { apiToken: "legacy", acceptLegacyApiToken: false }, lookup)
    ).resolves.toBeNull();
  });
});
