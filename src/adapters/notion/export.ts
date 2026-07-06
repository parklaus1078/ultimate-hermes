import { ApprovalRepository } from "../../db/approvals.js";

export async function requestNotionPageCreate(input: {
  parentPageId: string;
  title: string;
  body?: string;
}): Promise<{ approvalId: string }> {
  const approval = await new ApprovalRepository().create({
    requestedByProfile: "archivist",
    action: "notion.pageCreate",
    targetSystem: "notion",
    payload: input
  });
  return { approvalId: approval.id };
}
