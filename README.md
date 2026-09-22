# Life Archive MCP

Life Archive MCP는 Codex와 ChatGPT가 하나의 Supabase Postgres 장기 기억을 읽고 기록하게
해 주는 개인용 memory service입니다. 이 저장소의 이전 이름은 Ultimate Hermes였습니다.

```text
ChatGPT -----------\
Codex CLI ----------+--> Auth0 OAuth --> HTTPS /mcp --> Life Archive service
                                                  |
                                                  +--> Supabase Postgres
                                                       life_* + FTS + pg_trgm + pgvector

Hermes Agent --> native life_archive provider -----+
```

운영 원칙은 다음과 같습니다.

- `public.life_*`가 장기 기억의 source of truth입니다.
- public MCP 인증은 Auth0 OAuth 2.1 하나로 통일합니다.
- Agent에 DB 비밀번호, Auth0 Client Secret, 직접 만든 API key를 넣지 않습니다.
- access token의 issuer, audience, signature, expiry, scope를 모든 요청에서 검증합니다.
- 사용자는 최대 180일마다 Auth0 OAuth 연결을 새로 해야 합니다.
- CI와 무인 Agent 인증은 interactive 사용자 OAuth와 분리해 후속 구현합니다.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/parklaus1078/ultimate-hermes)

처음 설치한다면 [Auth0 OAuth 초보자용 설정 설명서](docs/auth0-oauth-setup.md)를 먼저
따르세요. Auth0 계정 만들기부터 ChatGPT, Codex, Render 연결까지 화면 순서대로 설명합니다.

## Current Status

| 영역 | 상태 |
| --- | --- |
| Supabase 호환 Postgres 스키마 | 구현 완료 |
| FTS, `pg_trgm`, `pgvector(1536)` | 구현 완료 |
| MCP SDK 기반 Streamable HTTP `/mcp` | 구현 완료 |
| Auth0 JWT/JWKS, audience, scope 검증 | 구현 완료 |
| OAuth protected resource metadata | 구현 완료 |
| 180일 rotating refresh-token 재로그인 정책 | 설정 절차 구현 완료 |
| Enterprise용 180일 서버 이중 검증 Action | 선택 사항으로 구현 완료 |
| ChatGPT/Codex Manual CIMD runbook | 문서화 완료 |
| Render Docker Blueprint | 구현 완료 |
| CI/무인 Agent 인증 | [backlog](docs/backlog-unattended-agent-auth.md) |
| 실제 Auth0 tenant와 Render 운영값 입력 | 배포 관리자가 수행 |

## Prerequisites

- Node.js 22 이상과 npm
- Docker Desktop — 기존 local Postgres를 사용할 때
- Supabase project
- Render account와 GitHub repository
- Auth0 tenant
- 선택 사항: Nous Research Hermes Agent

## Install

```bash
git clone https://github.com/parklaus1078/ultimate-hermes.git
cd ultimate-hermes
npm ci
```

## Database Setup

새 database는 migration 전용 URL로 schema를 먼저 만듭니다.

```bash
export HERMES_MIGRATION_DATABASE_URL='postgresql://MIGRATION_OWNER:...'
export HERMES_RUNTIME_DATABASE_URL='postgresql://hermes_runtime:...'
npm run db:migrate
```

Render runtime에는 `hermes_runtime`처럼 필요한 DML 권한만 가진 역할의 Supabase Session
Pooler URL을 사용합니다. 권장 형식은 다음과 같습니다.

```text
postgresql://hermes_runtime.PROJECT_REF:PASSWORD@REGION.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/app/certs/prod-ca-2021.crt
```

### 기존 local data를 Supabase로 옮기기

현재 local Docker Postgres를 빈 Supabase database로 옮길 때만 실행합니다.

```bash
printf 'Supabase runtime/session-pooler URL: '
IFS= read -r -s SUPABASE_DATABASE_URL
printf '\n'
export SUPABASE_DATABASE_URL

scripts/migrate_local_db_to_supabase.sh --dry-run
scripts/migrate_local_db_to_supabase.sh
```

script는 source/target table별 row count와 canonical content checksum을 비교합니다. 성공
출력은 다음 문장을 포함합니다.

```text
Migration verified. Exact row counts and content checksums match.
```

대상에 보존할 row가 있다면 자동 merge를 시도하지 말고 먼저 별도 export와 검토를 합니다.

## Auth0 OAuth Setup

운영 서버는 다음 인증 흐름을 사용합니다.

```text
MCP client
  -> GET /.well-known/oauth-protected-resource
  -> Auth0 Authorization Code + PKCE + CIMD
  -> RS256 access token
  -> Life Archive issuer/audience/expiry/scope validation
     (+ optional Enterprise session-age validation)
```

필수 Auth0 API permissions:

| Permission | 허용 작업 |
| --- | --- |
| `memory:read` | 조회, 검색, timeline, context pack |
| `memory:write` | append-only capture와 source link |
| `memory:admin` | 인증 request log 조회 |

긴 연결은 `offline_access`와 rotating refresh token을 사용합니다. ChatGPT와 Codex의 Auth0
application에서 refresh token family의 maximum/idle lifetime을 모두 `15552000`초(180일)로
고정합니다. 이 absolute maximum은 token rotation으로 연장되지 않으므로 180일 뒤 새 OAuth
로그인이 필요합니다. access token의 서버 허용 한도는 1시간입니다.

Auth0 Enterprise에서는 선택적 Post-Login Action으로 `<audience>/session_started_at` claim을
추가해 서버가 같은 경계를 이중 검증할 수 있습니다. 일반 Auth0 plan에서는 이 Action 없이
refresh-token maximum lifetime을 사용합니다.

전체 Dashboard 클릭 순서와 복사할 값은
[Auth0 OAuth 설정 설명서](docs/auth0-oauth-setup.md)에 있습니다.

## Deploy To Render

`render.yaml` Blueprint를 import하고 다음 secret/config를 입력합니다.

| Render variable | 값 |
| --- | --- |
| `HERMES_RUNTIME_DATABASE_URL` | Supabase `hermes_runtime` Session Pooler URL |
| `LIFE_ARCHIVE_AUTH0_ISSUER` | `https://TENANT.REGION.auth0.com/` |
| `LIFE_ARCHIVE_AUTH0_AUDIENCE` | 배포된 `https://HOST/mcp` |
| `LIFE_ARCHIVE_AUTH0_ALLOWED_SUBJECTS` | 허용할 Auth0 user ID, 쉼표 구분 |
| `LIFE_ARCHIVE_AUTH0_MAX_ACCESS_TOKEN_LIFETIME_SECONDS` | Blueprint 기본 `3600` |

`HERMES_API_TOKEN`과 `HERMES_ACCEPT_LEGACY_API_TOKEN`은 더 이상 사용하지 않습니다.

Blueprint 기본값은 Singapore Starter, readiness check, remote append-only writes, legacy HTTP
routes off, embedding off, DB pool 5개입니다. Web process는 migration을 실행하지 않고 schema가
준비됐는지만 확인합니다.

## Connect ChatGPT

ChatGPT의 custom connector/app에 다음 MCP URL을 등록하고 Authentication을 OAuth로
선택합니다.

```text
https://YOUR-LIFE-ARCHIVE.onrender.com/mcp
```

ChatGPT management 화면이 보여 주는 정확한 CIMD URL을 Auth0에서 **Applications →
Applications → Create Application → Import from URL**로 등록합니다. issuer response 설정이
올바르면 보통 `https://chatgpt.com/oauth/client.json`을 사용합니다. Auth0 API의
Application Access에서 이 CIMD application에 User-Delegated permissions를 부여해야 합니다.

Client Secret이나 client key를 ChatGPT 대화창에 입력하지 않습니다. 자세한 클릭 순서는
[설정 설명서의 ChatGPT 단계](docs/auth0-oauth-setup.md#7-chatgpt를-auth0에-등록하기)를
따릅니다.

## Connect Codex CLI

```bash
codex mcp add life-archive \
  --url 'https://YOUR-LIFE-ARCHIVE.onrender.com/mcp' \
  --oauth-resource 'https://YOUR-LIFE-ARCHIVE.onrender.com/mcp'

codex mcp login life-archive \
  --scopes memory:read,memory:write,memory:admin,offline_access \
  --oauth-client-registration cimd

codex mcp list
```

현재 Codex는 MCP URL마다 다음 형태의 CIMD를 사용할 수 있습니다.

```text
https://chatgpt.com/oauth/codex/<callback_id>/client.json
```

첫 login에서 사용된 전체 URL을 Auth0에 **Import from URL**로 한 번 등록한 뒤 login을 다시
실행합니다. `<callback_id>`를 추측하지 않습니다. 자세한 순서는
[설정 설명서의 Codex 단계](docs/auth0-oauth-setup.md#8-codex-cli를-auth0에-등록하기)를
따릅니다.

## MCP Tools

| Tool | Scope | 역할 |
| --- | --- | --- |
| `recent_events` | `memory:read` | 최근 durable event |
| `recall_events` | `memory:read` | FTS, fuzzy, optional vector recall |
| `timeline` | `memory:read` | topic/project chronological history |
| `context_pack` | `memory:read` | Agent용 Markdown context |
| `project_status` | `memory:read` | project history와 blocker 요약 |
| `memory_status` | `memory:read` | canonical table/vector 상태 |
| `capture_event` | `memory:write` | append-only event 저장 |
| `link_source` | `memory:write` | source/external reference 연결 |

`capture_event`와 `link_source`는 OAuth permission 외에도
`HERMES_ALLOW_REMOTE_WRITES=true`가 필요합니다.

## HTTP Endpoints

| Method/Path | Auth | 설명 |
| --- | --- | --- |
| `GET /api/v1/health` | 없음 | process liveness |
| `GET /api/v1/ready` | 없음 | DB/schema readiness |
| `GET /.well-known/oauth-protected-resource` | 없음 | OAuth resource metadata |
| `GET /.well-known/oauth-protected-resource/mcp` | 없음 | path-aware metadata alias |
| `POST /mcp` | Auth0 Bearer | Streamable HTTP MCP |
| `GET /api/v1/events/recent` | `memory:read` | 최근 memory |
| `POST /api/v1/recall` | `memory:read` | recall API |
| `GET /api/v1/timeline` | `memory:read` | timeline API |
| `POST /api/v1/context-pack` | `memory:read` | Markdown context |
| `POST /api/v1/events` | `memory:write` + writes enabled | append-only capture |
| `GET /api/v1/admin/request-logs` | `memory:admin` | request audit |

과거 enrollment/client-key management endpoint는 `410 Gone`을 반환합니다. `GET /mcp`와
`DELETE /mcp`는 stateless server이므로 `405`를 반환합니다.

## Security Model

- Auth0 JWKS에서 RS256 signature와 key ID를 검증합니다.
- exact issuer와 MCP audience를 검증합니다.
- `exp`, `nbf`, `iat`, 최대 access-token lifetime을 검증합니다.
- endpoint와 tool 권한에는 client가 실제로 위임받은 OAuth `scope`만 사용합니다. Auth0
  `permissions` claim은 권한 상승에 사용하지 않습니다.
- 선택적 Auth0 subject allowlist를 적용합니다.
- Auth0 rotating refresh-token family의 고정 maximum lifetime으로 180일 재로그인을 적용합니다.
- Enterprise Action을 명시적으로 설정한 경우 서버도 session-start claim을 이중 검증합니다.
- 잘못된 인증을 source IP별로 제한하고 반복 실패를 일시 차단합니다.
- Host/Origin allowlist와 bounded request metadata audit를 적용합니다.
- Supabase anonymous/authenticated role에는 application table 권한을 주지 않습니다.
- Docker container는 non-root Node user로 실행합니다.

인증 실패 제한은 [auth-failure-rate-limiting.md](docs/auth-failure-rate-limiting.md), 폐기된
client-key 방식은 [client-key-management.md](docs/client-key-management.md)에 역사 기록으로
남아 있습니다.

## Local Development

Auth0 issuer/audience가 없는 non-production loopback server는 local 개발 요청만 허용합니다.

```bash
docker compose up -d postgres
npm ci
export HERMES_DATABASE_URL='postgres://hermes:hermes@127.0.0.1:55432/hermes'
export HERMES_ALLOW_REMOTE_WRITES=true
npm run db:migrate
npm run dev
```

운영과 같은 Auth0 검증을 local에서 시험하려면
`LIFE_ARCHIVE_AUTH0_ISSUER`, `LIFE_ARCHIVE_AUTH0_AUDIENCE`와 Auth0 test API/client를
설정합니다.

## Verify Deployment

```bash
export LIFE_ARCHIVE_BASE_URL='https://YOUR-LIFE-ARCHIVE.onrender.com'

curl -fsS "$LIFE_ARCHIVE_BASE_URL/api/v1/health"
curl -fsS "$LIFE_ARCHIVE_BASE_URL/api/v1/ready"
curl -fsS "$LIFE_ARCHIVE_BASE_URL/.well-known/oauth-protected-resource"
curl -i -X POST "$LIFE_ARCHIVE_BASE_URL/mcp" \
  -H 'Content-Type: application/json' \
  --data '{}'
```

마지막 요청은 token이 없으므로 `401`이 정상입니다. 응답의 `WWW-Authenticate`에
`resource_metadata=`가 있어야 합니다.

## Project Verification

```bash
npm run verify
```

개별 검증은 `npm run typecheck`, `npm test`, `npm run test:life-archive`, `npm run build`입니다.

## Repository Layout

| Path | 역할 |
| --- | --- |
| `src/mcp/` | MCP tool과 stdio/Streamable HTTP server |
| `src/remote/auth0.ts` | Auth0 JWT/JWKS/scope와 선택적 session-age 검증 |
| `src/server/` | OAuth-protected Express service |
| `auth0/actions/` | Enterprise에서만 쓰는 선택적 Post-Login Action |
| `src/db/migrations/` | canonical/legacy/Supabase hardening schema |
| `hermes_plugins/life_archive/` | primary Hermes native provider |
| `scripts/migrate_local_db_to_supabase.sh` | checksum 검증 local-to-cloud migration |
| `docs/auth0-oauth-setup.md` | 초보자용 Auth0/ChatGPT/Codex/Render runbook |
| `docs/backlog-unattended-agent-auth.md` | CI/무인 Agent 인증 backlog |
| `render.yaml` | Render Blueprint |

## References

- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)
- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Auth0 manual CIMD registration](https://auth0.com/docs/get-started/auth0-overview/create-applications/register-applications-with-cimd)
- [Auth0 refresh token expiration](https://auth0.com/docs/secure/tokens/refresh-tokens/configure-refresh-token-expiration)
- [Supabase Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
