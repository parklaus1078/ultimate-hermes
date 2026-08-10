import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transactionQuery: vi.fn()
}));

vi.mock("../../src/db/client.js", () => ({
  query: mocks.query,
  withTransaction: async (fn: (client: { query: typeof mocks.transactionQuery }) => Promise<unknown>) =>
    fn({ query: mocks.transactionQuery })
}));

import { McpClientRepository, type EnrollmentRequest } from "../../src/db/mcp-clients.js";

function enrollment(overrides: Partial<EnrollmentRequest> = {}): EnrollmentRequest {
  return {
    id: "enrollment-1",
    tokenHash: "a".repeat(64),
    label: "test-codex",
    deviceName: "test",
    agentType: "codex",
    canManageClients: false,
    grantIfNoManager: true,
    expiresAt: new Date("2030-01-01T00:00:00Z"),
    createdByClientId: null,
    ...overrides
  };
}

describe("first MCP manager enrollment", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.transactionQuery.mockReset();
  });

  it("takes a transaction lock before granting the first manager enrollment", async () => {
    mocks.transactionQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ manager_exists: false }] })
      .mockResolvedValueOnce({ rows: [] });

    const granted = await new McpClientRepository().createEnrollment(enrollment());

    expect(granted).toBe(true);
    expect(mocks.transactionQuery.mock.calls[0]?.[0]).toContain("pg_advisory_xact_lock");
    expect(mocks.transactionQuery.mock.calls[1]?.[0]).toContain("mcp_enrollment_tokens");
    expect(mocks.transactionQuery.mock.calls[2]?.[1]?.[5]).toBe(true);
  });

  it("keeps a later automatic enrollment non-manager when one already exists", async () => {
    mocks.transactionQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ manager_exists: true }] })
      .mockResolvedValueOnce({ rows: [] });

    const granted = await new McpClientRepository().createEnrollment(enrollment());

    expect(granted).toBe(false);
    expect(mocks.transactionQuery.mock.calls[2]?.[1]?.[5]).toBe(false);
  });

  it("preserves an explicit manager grant without first-manager probing", async () => {
    mocks.transactionQuery.mockResolvedValueOnce({ rows: [] });

    const granted = await new McpClientRepository().createEnrollment(enrollment({
      canManageClients: true,
      grantIfNoManager: false
    }));

    expect(granted).toBe(true);
    expect(mocks.transactionQuery).toHaveBeenCalledTimes(1);
    expect(mocks.transactionQuery.mock.calls[0]?.[0]).toContain("insert into mcp_enrollment_tokens");
    expect(mocks.transactionQuery.mock.calls[0]?.[1]?.[5]).toBe(true);
  });
});
