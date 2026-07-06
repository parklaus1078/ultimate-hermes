import { createApprovalId } from "../core/ids.js";
import type { ApprovalStatus } from "../core/types.js";
import { query } from "./client.js";

export type ApprovalRequest = {
  id: string;
  requestedByProfile: string;
  action: string;
  targetSystem: string | null;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  requestedAt: Date;
  resolvedAt: Date | null;
};

function approvalFromRow(row: Record<string, unknown>): ApprovalRequest {
  return {
    id: row.id as string,
    requestedByProfile: row.requested_by_profile as string,
    action: row.action as string,
    targetSystem: (row.target_system as string | null) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: row.status as ApprovalStatus,
    requestedAt: new Date(row.requested_at as string),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null
  };
}

export class ApprovalRepository {
  async create(input: {
    requestedByProfile: string;
    action: string;
    targetSystem?: string | null;
    payload: Record<string, unknown>;
  }): Promise<ApprovalRequest> {
    const id = createApprovalId();
    const result = await query(
      `insert into approval_requests (id, requested_by_profile, action, target_system, payload, status)
       values ($1, $2, $3, $4, $5, 'pending')
       returning *`,
      [id, input.requestedByProfile, input.action, input.targetSystem ?? null, JSON.stringify(input.payload)]
    );
    return approvalFromRow(result.rows[0]!);
  }

  async listPending(): Promise<ApprovalRequest[]> {
    const result = await query("select * from approval_requests where status = 'pending' order by requested_at asc");
    return result.rows.map(approvalFromRow);
  }

  async getById(id: string): Promise<ApprovalRequest | null> {
    const result = await query("select * from approval_requests where id = $1", [id]);
    return result.rows[0] ? approvalFromRow(result.rows[0]) : null;
  }

  async resolve(id: string, status: "approved" | "rejected" | "executed"): Promise<ApprovalRequest | null> {
    const result = await query(
      `update approval_requests
       set status = $2, resolved_at = now()
       where id = $1
       returning *`,
      [id, status]
    );
    return result.rows[0] ? approvalFromRow(result.rows[0]) : null;
  }
}
