create index if not exists mcp_enrollment_tokens_used_client_idx
  on public.mcp_enrollment_tokens (used_client_id);

create index if not exists mcp_enrollment_tokens_created_by_client_idx
  on public.mcp_enrollment_tokens (created_by_client_id);
