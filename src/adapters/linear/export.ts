import { ApprovalRepository } from "../../db/approvals.js";
import { decidePolicy } from "../../core/policy.js";

export async function requestLinearIssueCreate(input: {
  title: string;
  description?: string;
  teamId?: string;
  projectId?: string;
}): Promise<{ approvalId: string; reason: string }> {
  const decision = decidePolicy("linear_write", "personal");
  const approvals = new ApprovalRepository();
  const approval = await approvals.create({
    requestedByProfile: "project-manager",
    action: "linear.issueCreate",
    targetSystem: "linear",
    payload: input
  });
  return { approvalId: approval.id, reason: decision.reason };
}
