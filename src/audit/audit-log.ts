import { createRunId } from "../core/ids.js";
import type { AgentRunStatus } from "../core/types.js";
import { query } from "../db/client.js";

export type AgentRun = {
  id: string;
  profileId: string;
  command: string;
  status: AgentRunStatus;
};

export class AuditLog {
  async start(profileId: string, command: string, input: Record<string, unknown> = {}): Promise<AgentRun> {
    const id = createRunId();
    await query(
      `insert into agent_runs (id, profile_id, command, input, status)
       values ($1,$2,$3,$4,'running')`,
      [id, profileId, command, JSON.stringify(input)]
    );
    return { id, profileId, command, status: "running" };
  }

  async finish(
    id: string,
    status: Exclude<AgentRunStatus, "running">,
    output: Record<string, unknown> = {},
    createdEventIds: string[] = [],
    externalWriteRefs: string[] = []
  ): Promise<void> {
    await query(
      `update agent_runs
       set status = $2,
           output = $3,
           created_event_ids = $4,
           external_write_refs = $5,
           finished_at = now()
       where id = $1`,
      [id, status, JSON.stringify(output), JSON.stringify(createdEventIds), JSON.stringify(externalWriteRefs)]
    );
  }
}
