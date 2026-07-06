import { createRunId } from "../core/ids.js";
import type { AgentRunStatus } from "../core/types.js";
import { query } from "./client.js";

export type AgentRun = {
  id: string;
  profileId: string;
  command: string;
  input?: Record<string, unknown>;
};

export class AuditRepository {
  async startRun(input: Omit<AgentRun, "id">): Promise<AgentRun> {
    const id = createRunId();
    await query(
      `insert into agent_runs (id, profile_id, command, input, status)
       values ($1, $2, $3, $4, 'running')`,
      [id, input.profileId, input.command, JSON.stringify(input.input ?? {})]
    );
    return { id, ...input };
  }

  async finishRun(
    id: string,
    status: AgentRunStatus,
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
