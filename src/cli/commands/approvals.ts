import type { Command } from "commander";
import { LinearClient } from "../../adapters/linear/client.js";
import { NotionClient } from "../../adapters/notion/client.js";
import { ApprovalRepository } from "../../db/approvals.js";
import { createSecretStore } from "../../secrets/index.js";
import { printJson } from "../output.js";

export function registerApprovals(program: Command): void {
  const approvals = program.command("approvals").description("Approval queue commands.");

  approvals
    .command("list")
    .description("List pending approvals.")
    .action(async () => {
      printJson(await new ApprovalRepository().listPending());
    });

  approvals
    .command("approve")
    .description("Approve a pending request.")
    .argument("<id>")
    .action(async (id: string) => {
      printJson(await new ApprovalRepository().resolve(id, "approved"));
    });

  approvals
    .command("reject")
    .description("Reject a pending request.")
    .argument("<id>")
    .action(async (id: string) => {
      printJson(await new ApprovalRepository().resolve(id, "rejected"));
    });

  approvals
    .command("execute")
    .description("Execute an approved external write request.")
    .argument("<id>")
    .action(async (id: string) => {
      const approvals = new ApprovalRepository();
      const approval = await approvals.getById(id);
      if (!approval) throw new Error(`Approval not found: ${id}`);
      if (approval.status !== "approved") {
        throw new Error(`Approval ${id} must be approved before execution. Current status: ${approval.status}`);
      }

      const secretStore = createSecretStore();
      let result: unknown;

      if (approval.action === "linear.issueCreate") {
        const payload = approval.payload as { teamId: string; title: string; description?: string; projectId?: string };
        if (!payload.teamId || !payload.title) throw new Error("linear.issueCreate payload requires teamId and title");
        result = await new LinearClient(secretStore).createIssue(payload);
      } else if (approval.action === "notion.pageCreate") {
        const payload = approval.payload as { parentPageId: string; title: string; body?: string };
        if (!payload.parentPageId || !payload.title) throw new Error("notion.pageCreate payload requires parentPageId and title");
        result = await new NotionClient(secretStore).createPage(payload);
      } else {
        throw new Error(`No executor registered for approval action: ${approval.action}`);
      }

      await approvals.resolve(id, "executed");
      printJson({ ok: true, approvalId: id, result });
    });
}
