import type pg from "pg";
import { createHermesId } from "../core/ids.js";
import { query, withTransaction } from "./client.js";

export const agentTypes = ["codex", "claude", "hermes", "other"] as const;
export type AgentType = (typeof agentTypes)[number];

export type McpClient = {
  id: string;
  keyId: string;
  keyHash: string;
  label: string;
  deviceName: string;
  agentType: AgentType;
  status: "active" | "revoked";
  canManageClients: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
};

export type PublicMcpClient = Omit<McpClient, "keyHash">;

export type EnrollmentRequest = {
  id: string;
  tokenHash: string;
  label: string;
  deviceName: string;
  agentType: AgentType;
  canManageClients: boolean;
  expiresAt: Date;
  createdByClientId: string | null;
};

export type RequestAudit = {
  requestId: string;
  clientId: string | null;
  clientLabel: string;
  deviceName: string;
  agentType: string;
  method: string;
  path: string;
  operation: string | null;
  statusCode: number;
  durationMs: number;
  sourceIp: string | null;
  socketIp: string | null;
  forwardedFor: string | null;
  userAgent: string | null;
  cfRay: string | null;
};

type ClientRow = {
  id: string;
  key_id: string;
  key_hash: string;
  label: string;
  device_name: string;
  agent_type: AgentType;
  status: "active" | "revoked";
  can_manage_clients: boolean;
  created_at: Date;
  updated_at: Date;
  last_seen_at: Date | null;
  revoked_at: Date | null;
};

function mapClient(row: ClientRow): McpClient {
  return {
    id: row.id,
    keyId: row.key_id,
    keyHash: row.key_hash,
    label: row.label,
    deviceName: row.device_name,
    agentType: row.agent_type,
    status: row.status,
    canManageClients: row.can_manage_clients,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at
  };
}

function publicClient(client: McpClient): PublicMcpClient {
  const { keyHash: _keyHash, ...safe } = client;
  return safe;
}

export class McpClientRepository {
  async findActiveByKeyId(keyId: string): Promise<McpClient | null> {
    const result = await query<ClientRow>(
      `select id, key_id, key_hash, label, device_name, agent_type, status,
              can_manage_clients, created_at, updated_at, last_seen_at, revoked_at
         from mcp_clients
        where key_id = $1 and status = 'active'`,
      [keyId]
    );
    return result.rows[0] ? mapClient(result.rows[0]) : null;
  }

  async touch(clientId: string): Promise<void> {
    await query(
      `update mcp_clients
          set last_seen_at = now(), updated_at = now()
        where id = $1
          and status = 'active'
          and (last_seen_at is null or last_seen_at < now() - interval '5 minutes')`,
      [clientId]
    );
  }

  async createEnrollment(input: EnrollmentRequest): Promise<void> {
    await query(
      `insert into mcp_enrollment_tokens (
         id, token_hash, label, device_name, agent_type, can_manage_clients,
         expires_at, created_by_client_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.id,
        input.tokenHash,
        input.label,
        input.deviceName,
        input.agentType,
        input.canManageClients,
        input.expiresAt,
        input.createdByClientId
      ]
    );
  }

  async exchangeEnrollment(input: {
    enrollmentId: string;
    tokenHash: string;
    keyId: string;
    keyHash: string;
  }): Promise<PublicMcpClient | null> {
    return withTransaction(async (client) => {
      const enrollment = await client.query<{
        label: string;
        device_name: string;
        agent_type: AgentType;
        can_manage_clients: boolean;
        expires_at: Date;
        used_client_id: string | null;
      }>(
        `select label, device_name, agent_type, can_manage_clients, expires_at, used_client_id
           from mcp_enrollment_tokens
          where id = $1 and token_hash = $2
          for update`,
        [input.enrollmentId, input.tokenHash]
      );
      const record = enrollment.rows[0];
      if (!record) return null;

      if (record.used_client_id) {
        const existing = await this.clientById(client, record.used_client_id);
        if (existing?.status === "active" && existing.keyId === input.keyId && existing.keyHash === input.keyHash) {
          return publicClient(existing);
        }
        return null;
      }

      if (record.expires_at.getTime() <= Date.now()) return null;

      const clientId = createHermesId("mcpcli");
      const inserted = await client.query<ClientRow>(
        `insert into mcp_clients (
           id, key_id, key_hash, label, device_name, agent_type, can_manage_clients
         ) values ($1, $2, $3, $4, $5, $6, $7)
         returning id, key_id, key_hash, label, device_name, agent_type, status,
                   can_manage_clients, created_at, updated_at, last_seen_at, revoked_at`,
        [
          clientId,
          input.keyId,
          input.keyHash,
          record.label,
          record.device_name,
          record.agent_type,
          record.can_manage_clients
        ]
      );
      await client.query(
        `update mcp_enrollment_tokens
            set used_at = now(), used_client_id = $2
          where id = $1`,
        [input.enrollmentId, clientId]
      );
      return publicClient(mapClient(inserted.rows[0]!));
    });
  }

  async listClients(): Promise<PublicMcpClient[]> {
    const result = await query<ClientRow>(
      `select id, key_id, key_hash, label, device_name, agent_type, status,
              can_manage_clients, created_at, updated_at, last_seen_at, revoked_at
         from mcp_clients
        order by created_at desc`
    );
    return result.rows.map(mapClient).map(publicClient);
  }

  async revoke(clientId: string): Promise<PublicMcpClient | null> {
    const result = await query<ClientRow>(
      `update mcp_clients
          set status = 'revoked', revoked_at = now(), updated_at = now()
        where id = $1 and status = 'active'
      returning id, key_id, key_hash, label, device_name, agent_type, status,
                can_manage_clients, created_at, updated_at, last_seen_at, revoked_at`,
      [clientId]
    );
    return result.rows[0] ? publicClient(mapClient(result.rows[0])) : null;
  }

  async recordRequest(input: RequestAudit): Promise<void> {
    await query(
      `insert into mcp_request_audit (
         id, request_id, client_id, client_label, device_name, agent_type, method, path,
         operation, status_code, duration_ms, source_ip, socket_ip,
         forwarded_for, user_agent, cf_ray
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        createHermesId("mcpreq"),
        input.requestId,
        input.clientId,
        input.clientLabel,
        input.deviceName,
        input.agentType,
        input.method,
        input.path,
        input.operation,
        input.statusCode,
        input.durationMs,
        input.sourceIp,
        input.socketIp,
        input.forwardedFor,
        input.userAgent,
        input.cfRay
      ]
    );
  }

  async listRequestLogs(limit: number): Promise<Record<string, unknown>[]> {
    const result = await query(
      `select id, request_id, client_id, client_label, device_name, agent_type, method, path,
              operation, status_code, duration_ms, source_ip, socket_ip,
              forwarded_for, user_agent, cf_ray, created_at
         from mcp_request_audit
        order by created_at desc
        limit $1`,
      [limit]
    );
    return result.rows;
  }

  private async clientById(client: pg.PoolClient, clientId: string): Promise<McpClient | null> {
    const result = await client.query<ClientRow>(
      `select id, key_id, key_hash, label, device_name, agent_type, status,
              can_manage_clients, created_at, updated_at, last_seen_at, revoked_at
         from mcp_clients
        where id = $1`,
      [clientId]
    );
    return result.rows[0] ? mapClient(result.rows[0]) : null;
  }
}
