# Ultimate Hermes Private-Network Fallback

Status: legacy fallback

The primary deployment path is now Supabase plus the authenticated HTTPS MCP
service documented in `README.md`. Use this document only when cloud deployment
is unavailable and the MacBook must remain the server.

Do not commit a real Tailscale IP, hostname, username, or API token.

## Architecture

```text
Remote agent -> Tailscale -> Ultimate Hermes MCP -> local Docker Postgres
```

Postgres must stay bound to localhost. Only the authenticated MCP/API port may
bind to the MacBook's Tailscale address.

## Start The Server

```bash
export TAILSCALE_IP="$(tailscale ip -4 | head -n 1)"
export HERMES_HOST="$TAILSCALE_IP"
export HERMES_PORT=8787
export HERMES_PUBLIC_BASE_URL="http://${TAILSCALE_IP}:8787"
export HERMES_API_TOKEN="$(openssl rand -hex 32)"
export HERMES_ALLOW_REMOTE_WRITES=true

npm run build
npm start
```

Store the token in a password manager. Do not place it in chat, git, Notion,
Linear, or logs.

## HTTP MCP

Use the following endpoint from another Tailscale device:

```text
http://<macbook-tailnet-ip>:8787/mcp
```

Send this header:

```text
Authorization: Bearer <HERMES_API_TOKEN>
```

The available tools match the cloud deployment:

```text
recent_events
recall_events
timeline
context_pack
project_status
memory_status
capture_event
link_source
```

## Stdio Through Tailscale SSH

Use this only for clients that cannot use Streamable HTTP with a bearer token.

```json
{
  "mcpServers": {
    "ultimate-hermes": {
      "command": "ssh",
      "args": [
        "-T",
        "<user>@<macbook-tailnet-name>",
        "cd <ultimate-hermes-path> && node dist/src/mcp/server.js"
      ]
    }
  }
}
```

## Verify

```bash
curl "http://<macbook-tailnet-ip>:8787/api/v1/health"
curl "http://<macbook-tailnet-ip>:8787/api/v1/ready"
```

Cloud migration does not delete this fallback or the local Docker volume. To
return to the primary cloud path, follow `README.md` and point clients at the
HTTPS Render `/mcp` URL.
