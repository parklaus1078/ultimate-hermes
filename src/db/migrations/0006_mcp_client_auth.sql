create table if not exists public.mcp_clients (
  id text primary key,
  key_id text not null unique check (key_id ~ '^[a-f0-9]{16}$'),
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  label text not null check (char_length(label) between 1 and 100),
  device_name text not null check (char_length(device_name) between 1 and 100),
  agent_type text not null check (agent_type in ('codex', 'claude', 'hermes', 'other')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  can_manage_clients boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  check ((status = 'active' and revoked_at is null) or (status = 'revoked' and revoked_at is not null))
);

create table if not exists public.mcp_enrollment_tokens (
  id text primary key check (id ~ '^[a-f0-9]{16}$'),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  label text not null check (char_length(label) between 1 and 100),
  device_name text not null check (char_length(device_name) between 1 and 100),
  agent_type text not null check (agent_type in ('codex', 'claude', 'hermes', 'other')),
  can_manage_clients boolean not null default false,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_client_id text references public.mcp_clients(id),
  created_by_client_id text references public.mcp_clients(id),
  created_at timestamptz not null default now(),
  check ((used_at is null and used_client_id is null) or (used_at is not null and used_client_id is not null))
);

create table if not exists public.mcp_request_audit (
  id text primary key,
  request_id text not null unique,
  client_id text references public.mcp_clients(id) on delete set null,
  client_label text not null,
  device_name text not null,
  agent_type text not null,
  method text not null,
  path text not null,
  operation text,
  status_code integer not null check (status_code between 100 and 599),
  duration_ms integer not null check (duration_ms >= 0),
  source_ip text,
  socket_ip text,
  forwarded_for text,
  user_agent text,
  cf_ray text,
  created_at timestamptz not null default now()
);

create index if not exists mcp_request_audit_client_created_idx
  on public.mcp_request_audit (client_id, created_at desc);
create index if not exists mcp_request_audit_created_idx
  on public.mcp_request_audit (created_at desc);
create index if not exists mcp_enrollment_tokens_expires_idx
  on public.mcp_enrollment_tokens (expires_at);

revoke all privileges on table
  public.mcp_clients,
  public.mcp_enrollment_tokens,
  public.mcp_request_audit
from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all privileges on table public.mcp_clients, public.mcp_enrollment_tokens, public.mcp_request_audit from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all privileges on table public.mcp_clients, public.mcp_enrollment_tokens, public.mcp_request_audit from authenticated;
  end if;
end
$$;

grant select, insert on table public.mcp_clients to hermes_runtime;
grant update (status, revoked_at, last_seen_at, updated_at) on table public.mcp_clients to hermes_runtime;
grant select, insert on table public.mcp_enrollment_tokens to hermes_runtime;
grant update (used_at, used_client_id) on table public.mcp_enrollment_tokens to hermes_runtime;
grant select, insert on table public.mcp_request_audit to hermes_runtime;

alter table public.mcp_clients enable row level security;
alter table public.mcp_enrollment_tokens enable row level security;
alter table public.mcp_request_audit enable row level security;

drop policy if exists hermes_runtime_read_mcp_clients on public.mcp_clients;
create policy hermes_runtime_read_mcp_clients
  on public.mcp_clients for select to hermes_runtime using (true);
drop policy if exists hermes_runtime_insert_mcp_clients on public.mcp_clients;
create policy hermes_runtime_insert_mcp_clients
  on public.mcp_clients for insert to hermes_runtime with check (true);
drop policy if exists hermes_runtime_update_mcp_clients on public.mcp_clients;
create policy hermes_runtime_update_mcp_clients
  on public.mcp_clients for update to hermes_runtime using (true) with check (true);

drop policy if exists hermes_runtime_read_enrollment_tokens on public.mcp_enrollment_tokens;
create policy hermes_runtime_read_enrollment_tokens
  on public.mcp_enrollment_tokens for select to hermes_runtime using (true);
drop policy if exists hermes_runtime_insert_enrollment_tokens on public.mcp_enrollment_tokens;
create policy hermes_runtime_insert_enrollment_tokens
  on public.mcp_enrollment_tokens for insert to hermes_runtime with check (true);
drop policy if exists hermes_runtime_update_enrollment_tokens on public.mcp_enrollment_tokens;
create policy hermes_runtime_update_enrollment_tokens
  on public.mcp_enrollment_tokens for update to hermes_runtime using (true) with check (true);

drop policy if exists hermes_runtime_read_request_audit on public.mcp_request_audit;
create policy hermes_runtime_read_request_audit
  on public.mcp_request_audit for select to hermes_runtime using (true);
drop policy if exists hermes_runtime_insert_request_audit on public.mcp_request_audit;
create policy hermes_runtime_insert_request_audit
  on public.mcp_request_audit for insert to hermes_runtime with check (true);
