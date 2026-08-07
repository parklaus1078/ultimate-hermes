import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildInstallCommand } from "../../src/server/app.js";

describe("one-command client enrollment", () => {
  it("builds an Agent-specific one-line command without an API key", () => {
    const command = buildInstallCommand({
      baseUrl: "https://hermes.example",
      enrollmentToken: "uhe_0123456789abcdef_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      deviceName: "kay studio mac",
      agentType: "codex"
    });
    expect(command).toContain("mcp-client.mjs");
    expect(command).toContain("--agent 'codex'");
    expect(command).toContain("--name 'kay studio mac'");
    expect(command).not.toContain("uhm_");
  });

  it("uses the Hermes virtualenv installer for YAML and env-secret support", () => {
    const command = buildInstallCommand({
      baseUrl: "https://hermes.example",
      enrollmentToken: "uhe_0123456789abcdef_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      deviceName: "server-1",
      agentType: "hermes"
    });
    expect(command).toContain('"$HOME/.hermes/hermes-agent/venv/bin/python"');
    expect(command).toContain("mcp-client.py");
  });

  it("ships installers that generate keys locally and register only hashes", async () => {
    const nodeInstaller = await readFile(new URL("../../scripts/install_mcp_client.mjs", import.meta.url), "utf8");
    const hermesInstaller = await readFile(new URL("../../scripts/install_mcp_client.py", import.meta.url), "utf8");
    expect(nodeInstaller).toContain('randomBytes(32)');
    expect(nodeInstaller).toContain("keyHash");
    expect(nodeInstaller).not.toContain("body: JSON.stringify({ keyId: credential.keyId, key: credential.key");
    expect(hermesInstaller).toContain("secrets.token_hex(32)");
    expect(hermesInstaller).toContain('body={"keyId": key_id, "keyHash": key_hash}');
  });
});
