# Ultimate Hermes Remote Agent Setup

This document explains how to attach any MCP-capable runtime agent — Claude Code, Codex, Hermes, Cursor, etc. — to the same Ultimate Hermes data layer.

## Current MacBook server

Ultimate Hermes API/MCP is running on the MacBook through launchd:

```text
service: com.kay.ultimate-hermes-api
runtime: /Users/kay/.hermes/ultimate-hermes-runtime
Tailscale IP: 100.104.147.86
API/MCP port: 8787
MCP endpoint: http://100.104.147.86:8787/mcp
Health endpoint: http://100.104.147.86:8787/api/v1/health
```

Postgres remains private/local to the MacBook:

```text
ultimate-hermes-postgres: 127.0.0.1:55432 -> 5432
```

The intended path is:

```text
PC Agent -> Tailscale -> Ultimate Hermes API/MCP -> local Life Archive/Postgres
```

Do not expose Postgres directly to the PC or agents.

## Option A — HTTP MCP

Use this when the MCP client supports remote HTTP MCP and custom headers.

Endpoint:

```text
http://100.104.147.86:8787/mcp
```

Authentication:

```text
Authorization: Bearer <HERMES_API_TOKEN>
```

The token lives on the MacBook runtime `.env` file:

```text
/Users/kay/.hermes/ultimate-hermes-runtime/.env
```

Do not print or paste the token into chat, git, Notion, Linear, or logs.

Available tools:

```text
recent_events
recall_events
timeline
context_pack
capture_event
```

Use `capture_event` only when Kay explicitly authorizes a durable write or a project policy already grants that write.

## Option B — stdio MCP through Tailscale SSH

Use this when the MCP client supports stdio MCP better than HTTP MCP, or when custom HTTP auth headers are awkward.

The PC agent starts a remote process on the MacBook over Tailscale SSH. DB access stays local to the MacBook.

Generic MCP config shape:

```json
{
  "mcpServers": {
    "ultimate-hermes": {
      "command": "ssh",
      "args": [
        "-T",
        "kay@100.104.147.86",
        "cd /Users/kay/.hermes/ultimate-hermes-runtime && node dist/src/mcp/server.js"
      ]
    }
  }
}
```

If the PC uses a Tailscale machine DNS name, replace `100.104.147.86` with that name.

## Codex config example

Codex config is TOML, usually at:

```text
~/.codex/config.toml
```

Add:

```toml
[mcp_servers.ultimate_hermes]
command = "ssh"
args = [
  "-T",
  "kay@100.104.147.86",
  "cd /Users/kay/.hermes/ultimate-hermes-runtime && node dist/src/mcp/server.js"
]
startup_timeout_sec = 30
```

Restart Codex after editing the config.

If using HTTP MCP and the Codex build supports URL/header MCP config, prefer this conceptual shape instead:

```toml
[mcp_servers.ultimate_hermes]
url = "http://100.104.147.86:8787/mcp"

[mcp_servers.ultimate_hermes.headers]
Authorization = "Bearer <HERMES_API_TOKEN>"
```

Use the actual Codex-supported syntax for remote MCP if it differs.

## Claude Code config example

Claude Code commonly supports adding stdio MCP servers with a command/args shape.
Use the equivalent of:

```json
{
  "mcpServers": {
    "ultimate-hermes": {
      "command": "ssh",
      "args": [
        "-T",
        "kay@100.104.147.86",
        "cd /Users/kay/.hermes/ultimate-hermes-runtime && node dist/src/mcp/server.js"
      ]
    }
  }
}
```

If using the Claude CLI, the command is conceptually:

```bash
claude mcp add ultimate-hermes -- ssh -T kay@100.104.147.86 'cd /Users/kay/.hermes/ultimate-hermes-runtime && node dist/src/mcp/server.js'
```

Verify against the installed Claude Code version's `claude mcp --help` output before relying on exact flags.

## Smoke tests from a PC shell

Health check:

```bash
curl http://100.104.147.86:8787/api/v1/health
```

Authenticated recall:

```bash
curl -H "Authorization: Bearer <HERMES_API_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"query":"Ultimate Hermes","limit":1}' \
  http://100.104.147.86:8787/api/v1/recall
```

MCP tools/list over HTTP:

```bash
curl -H "Authorization: Bearer <HERMES_API_TOKEN>" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  http://100.104.147.86:8787/mcp
```

## Operational commands on MacBook

Check service:

```bash
launchctl print gui/$(id -u)/com.kay.ultimate-hermes-api
```

Restart service:

```bash
launchctl kickstart -k gui/$(id -u)/com.kay.ultimate-hermes-api
```

Check logs:

```bash
tail -n 80 /Users/kay/.hermes/logs/ultimate-hermes-api.out.log
tail -n 80 /Users/kay/.hermes/logs/ultimate-hermes-api.err.log
```

Check listening port:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

## Mental model

Agents are runtimes. The durable data is not in Claude Code, Codex, or Hermes chat context. The durable data is in Life Archive/Postgres and related external source inventories. Every agent should call the same `ultimate-hermes` MCP/API layer before acting when project context, decisions, or history matter.
