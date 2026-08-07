# Ultimate Hermes

Ultimate Hermes는 Codex, Claude Code, Nous Research Hermes Agent를 교체 가능한
runtime으로 사용하면서, 모든 장기 기억을 하나의 Supabase Postgres에 보관하는
개인용 memory service입니다.

```text
Codex --------------------\
Claude Code ---------------+--> HTTPS /mcp --> Ultimate Hermes container
Hermes Agent (remote) -----/          |
                                       +--> Supabase Postgres
Hermes primary gateway ---------------/    life_* + FTS + pg_trgm + pgvector
  (optional native DB access)

Agent runtimes ----------------------------> Notion, Linear, Google, Slack
                                             (external source surfaces)
```

핵심 원칙은 다음과 같습니다.

- Agent는 대화와 도구 실행을 담당하는 runtime이다.
- `public.life_*`가 장기 기억의 유일한 source of truth다.
- Codex, Claude, 보조 Hermes에는 DB 비밀번호를 주지 않는다.
- 원격 Agent는 HTTPS MCP URL과 API token만 사용한다.
- Linear는 현재 실행할 티켓, Notion은 사람이 읽는 inventory다.
- 같은 기억을 native `life_capture`와 MCP `capture_event`로 중복 저장하지 않는다.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/parklaus1078/ultimate-hermes)

## Current Status

| 영역 | 상태 |
| --- | --- |
| Supabase 호환 Postgres 스키마 | 구현 완료 |
| FTS, `pg_trgm`, `pgvector(1536)` | 구현 완료 |
| 공식 MCP SDK 기반 Streamable HTTP `/mcp` | 구현 완료 |
| Bearer 인증, Host/Origin 검증, RLS hardening | 구현 완료 |
| Render Docker Blueprint | 구현 완료 |
| Codex, Claude, Hermes 설정 예시 | 구현 및 CLI 문법 검증 완료 |
| 로컬 DB 전체 migration rehearsal | table별 row count와 content checksum 일치 검증 완료 |
| 실제 Supabase project 생성 및 Render 배포 | 사용자 cloud credential 입력 후 수행 |

2026-08-06 검증 시 로컬 원본에는 다음 데이터가 있었습니다. 실제 migration
script는 실행 시점의 수치를 다시 계산합니다.

| Table | Rows |
| --- | ---: |
| `life_events` | 822 |
| `life_external_refs` | 205 |
| `life_sources` | 243 |
| `life_recall_hits` | 3373 |
| `life_embeddings` | 0 |
| legacy `events` | 4 |
| legacy `embeddings` | 4 |
| legacy `agent_runs` | 4 |

로컬 원본 DB는 migration 과정에서 수정하거나 삭제하지 않습니다.

## Prerequisites

- Docker Desktop
- Node.js 22 이상
- npm
- Supabase project 하나
- GitHub에 push된 이 repository
- Render account
- 선택 사항: Nous Research Hermes Agent

macOS의 현재 로컬 원본은 기본적으로 다음 컨테이너를 사용합니다.

```text
container: ultimate-hermes-postgres
host port: 127.0.0.1:55432
database: hermes
```

## Cloud Setup

아래 순서를 그대로 따르면 기존 데이터를 Supabase로 옮긴 뒤 Render MCP 서버를
배포할 수 있습니다.

### 1. Install

```bash
git clone https://github.com/parklaus1078/ultimate-hermes.git
cd ultimate-hermes
npm ci
```

이미 이 repository를 사용 중이면 현재 branch를 push하거나 default branch에
merge한 뒤 진행합니다. Render Deploy button은 GitHub에 있는 코드를 사용합니다.

### 2. Create Supabase Database

1. Supabase에서 새 project를 생성합니다.
2. 가능하면 Render service와 가까운 region을 선택합니다. 기본 Blueprint region은
   Singapore입니다.
3. Supabase dashboard의 **Connect**에서 migration용 관리자 connection string을 복사합니다.
4. persistent container에는 별도 `hermes_runtime` 역할의 **Session pooler** port `5432`
   URL을 사용합니다.
5. Render runtime URL에는 `sslmode=verify-full`과 이미지에 포함된 Supabase CA 경로를
   추가합니다.

형식은 대략 다음과 같습니다. 예시를 그대로 사용하면 안 됩니다.

```text
postgresql://hermes_runtime.PROJECT_REF:PASSWORD@REGION.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/app/certs/prod-ca-2021.crt
```

Dashboard가 출력한 URL을 그대로 사용하는 편이 안전합니다. 비밀번호의 특수문자를
직접 조합할 경우에는 URL encoding이 필요합니다.

현재 terminal session에 URL을 노출 없이 입력합니다.

```bash
printf 'Supabase runtime session-pooler URL: '
IFS= read -r -s SUPABASE_DATABASE_URL
printf '\n'
export SUPABASE_DATABASE_URL

printf 'Supabase migration/admin URL: '
IFS= read -r -s SUPABASE_MIGRATION_DATABASE_URL
printf '\n'
export SUPABASE_MIGRATION_DATABASE_URL
```

Supabase REST/Data API key는 이 서비스에 필요하지 않습니다. 관리자 URL은 격리된
migration runner에만 두고, Render에는 `hermes_runtime` URL만 저장합니다.

### 3. Freeze Writes And Inspect Migration

최종 migration 동안에는 새 memory capture를 잠시 중단합니다.

```bash
hermes gateway stop
docker compose up -d postgres
scripts/migrate_local_db_to_supabase.sh --dry-run
```

`--dry-run`은 원본 table별 row count/content checksum과 대상 연결만 확인하며 대상
schema나 data를 변경하지 않습니다.

### 4. Migrate Existing Data

대상 Supabase database가 비어 있는 상태에서 실행합니다.

```bash
scripts/migrate_local_db_to_supabase.sh
```

script가 수행하는 작업은 다음과 같습니다.

1. 로컬 Docker Postgres의 모든 canonical/legacy application table 수를 기록합니다.
2. Supabase에 모든 schema migration을 적용합니다.
3. 대상에 기존 application row가 있으면 기본적으로 중단합니다.
4. mode `700` 임시 directory에 private custom-format dump를 만듭니다.
5. `pg_restore --single-transaction`으로 data를 복원합니다.
6. 모든 application table의 source/target row count와 canonical row content
   checksum을 정확히 비교합니다.
7. `migration-reports/<timestamp>/`에 source/target integrity manifest와 dump
   checksum을 남깁니다.
8. dump는 성공과 실패 여부에 관계없이 기본적으로 삭제합니다.

성공 출력은 다음 문장을 포함합니다.

```text
Migration verified. Exact row counts and content checksums match.
```

`--allow-nonempty`는 duplicate key와 merge 결과를 직접 검토한 경우에만 사용합니다.
일반적인 재시도는 빈 Supabase project/database를 준비하는 편이 안전합니다.

### 5. Generate Bootstrap Admin Token

```bash
export HERMES_API_TOKEN="$(openssl rand -hex 32)"
```

이 값은 password manager에 저장합니다. macOS에서 화면에 출력하지 않고 clipboard로
보내려면 다음을 사용합니다.

```bash
printf '%s' "$HERMES_API_TOKEN" | pbcopy
```

이 값은 최초 client key를 발급하는 전환용 관리자 token입니다. 모든 Agent가 이 값을
공유하지 않습니다. 배포 후 각 `기기 × Agent` 조합에 별도 key를 발급하고,
전환이 끝나면 `HERMES_ACCEPT_LEGACY_API_TOKEN=false`로 차단합니다.

### 6. Deploy To Render

README 상단의 **Deploy to Render** button을 누르거나 Render에서 이 repository의
`render.yaml`을 Blueprint로 import합니다.

Render가 묻는 두 secret과 bootstrap switch를 입력합니다. 공개 Blueprint에서는 이
switch를 `sync: false`로 두므로 기존 서비스의 운영값을 repository sync가 덮어쓰지
않습니다.

| Render variable | 값 |
| --- | --- |
| `HERMES_RUNTIME_DATABASE_URL` | `hermes_runtime` Supabase session-pooler URL |
| `HERMES_API_TOKEN` | 최초 client 등록용 64자리 bootstrap token |
| `HERMES_ACCEPT_LEGACY_API_TOKEN` | 최초 bootstrap 동안만 `true`; manager 확인 후 `false` |

Blueprint의 기본 동작은 다음과 같습니다.

- Dockerfile build
- Singapore region
- Starter instance
- `GET /api/v1/ready` readiness check
- remote append-only writes enabled
- legacy HTTP routes disabled
- embedding API disabled
- DB pool 최대 5 connections

Starter는 cold start 없는 개인 서비스에 적합한 기본값입니다. 비용을 우선하면 Render
dashboard에서 지원되는 더 작은 plan으로 바꿀 수 있지만, sleep/cold start 때문에 MCP
client timeout이 발생할 수 있습니다.

동일한 Docker image는 Render 대신 Azure Container Apps, Google Cloud Run,
AWS ECS/Fargate, Railway, Fly.io에도 배포할 수 있습니다. 필요한 runtime contract는
다음뿐입니다.

```text
PORT=<platform assigned port>
NODE_ENV=production
HERMES_RUNTIME_DATABASE_URL=<hermes_runtime Supabase session-pooler URL>
HERMES_API_TOKEN=<bootstrap admin secret>
HERMES_ACCEPT_LEGACY_API_TOKEN=true # initial bootstrap only
```

Netlify Functions는 이 버전의 기본 target이 아닙니다. persistent Express process와
Postgres pool을 사용할 수 있는 container platform이 더 단순합니다. Schema migration은
runtime web process가 아니라 별도의 `npm run db:migrate` 작업으로 실행합니다.

### 7. Verify Deployment

배포 후 URL을 설정합니다.

```bash
export ULTIMATE_HERMES_BASE_URL="https://YOUR-SERVICE.onrender.com"
export ULTIMATE_HERMES_MCP_URL="$ULTIMATE_HERMES_BASE_URL/mcp"
export ULTIMATE_HERMES_API_TOKEN="$HERMES_API_TOKEN"
```

Liveness와 DB readiness를 확인합니다.

```bash
curl -fsS "$ULTIMATE_HERMES_BASE_URL/api/v1/health"
curl -fsS "$ULTIMATE_HERMES_BASE_URL/api/v1/ready"
```

MCP initialize를 확인합니다.

```bash
curl -fsS "$ULTIMATE_HERMES_MCP_URL" \
  -H "Authorization: Bearer $ULTIMATE_HERMES_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-smoke","version":"1.0.0"}}}'
```

`401`이면 token이 다르고, `403`이면 Host 또는 Origin allowlist가 맞지 않습니다.

## Connect Agents

모든 remote agent는 같은 MCP URL을 사용하지만 API key는 공유하지 않습니다. 식별 단위는
`기기 × Agent`입니다. 예를 들어 같은 Mac의 Codex와 Claude도 서로 다른 key를 갖습니다.

```text
https://YOUR-SERVICE.onrender.com/mcp
```

### 1. 새 client용 원클릭 명령 만들기

관리 PC의 repository에서 bootstrap token 또는 `canManageClients` 권한이 있는 client key를
환경 변수로 읽은 뒤 명령 하나를 만듭니다. token은 출력되지 않고, 결과에는 10분 뒤
만료되며 한 번만 쓸 수 있는 등록 코드만 들어갑니다.

```bash
printf 'Ultimate Hermes admin token: '
IFS= read -r -s ULTIMATE_HERMES_ADMIN_TOKEN
printf '\n'
export ULTIMATE_HERMES_ADMIN_TOKEN

npm run clients -- create --device "kay-macbook" --agent codex
npm run clients -- create --device "kay-macbook" --agent claude
npm run clients -- create --device "home-server" --agent hermes
```

이미 관리자 client가 설치된 장비에서는 환경 변수를 만들지 않고 해당 Agent 설정에서
key를 안전하게 읽을 수도 있습니다.

```bash
npm run clients -- create --auth-agent codex --device "new-mac" --agent claude
```

최초 trusted 관리 장비를 등록할 때만 `--admin`을 추가합니다. 일반 Agent key에는 관리
권한을 주지 않습니다.

```bash
npm run clients -- create --device "admin-mac" --agent codex --admin
```

### 2. 대상 기기에서 명령 한 줄 실행

출력된 한 줄을 새 기기 Terminal에서 그대로 실행합니다. 설치기는 대상 기기에서
256-bit random API key를 만들고 SHA-256 hash만 서버에 등록합니다. 원문 key는 서버의
client table이나 등록 요청 body에 저장되지 않습니다.

- Codex: `~/.codex/config.toml`의 `ultimate-hermes` HTTP header를 mode `600` 파일에 저장
- Claude Code: user scope `~/.claude.json`에 HTTP header를 저장
- Hermes: `~/.hermes/.env`에 key를 mode `600`으로 저장하고 config에는 placeholder만 저장
- 세 설치기 모두 MCP `initialize`까지 실행해 새 key를 검증

등록 코드는 shell history에 남을 수 있지만 짧게 만료되고 성공 즉시 재사용할 수 없습니다.
원문 API key는 설치기 출력에 표시되지 않습니다. `curl | runtime` 실행 전 내용을
검사하려면 installer URL을 먼저 파일로 내려받아 확인한 뒤 실행합니다.

### 3. client와 로그 관리

```bash
npm run clients -- list --auth-agent codex
npm run clients -- logs --auth-agent codex --limit 50
npm run clients -- revoke CLIENT_ID --auth-agent codex
```

로그에는 client ID/label, 기기명에 연결된 Agent 종류, MCP method/tool, status, latency,
request ID, best-effort source IP, user-agent가 기록됩니다. Authorization header와 request
body는 기록하지 않습니다. 응답의 `X-Hermes-Request-Id`로 Render log와 DB audit row를
연결할 수 있습니다.

### 4. 공유 bootstrap token 차단

관리 key로 `create`, `list`, `logs`, `revoke`가 모두 되는 것을 확인한 뒤 Render에서
다음 값을 바꾸고 redeploy합니다.

```text
HERMES_ACCEPT_LEGACY_API_TOKEN=false
```

이후 기존 `HERMES_API_TOKEN`은 인증에 사용할 수 없습니다. client 하나를 폐기해도 다른
기기와 Agent는 계속 동작합니다. 전체 절차와 복구 순서는
`docs/client-key-management.md`에 있습니다.

### 수동 설정 호환 경로

기존 공유 token 방식은 전환 기간에만 사용할 수 있습니다.

```bash
export ULTIMATE_HERMES_MCP_URL="https://YOUR-SERVICE.onrender.com/mcp"
export ULTIMATE_HERMES_API_TOKEN="$HERMES_API_TOKEN"

codex mcp add ultimate-hermes \
  --url "$ULTIMATE_HERMES_MCP_URL" \
  --bearer-token-env-var ULTIMATE_HERMES_API_TOKEN

codex mcp list
```

### Hermes Agent: Primary Native Provider

Slack gateway를 운영하는 신뢰된 primary Mac에서는 remote hop 없이 native
`life_archive` provider가 Supabase에 직접 연결할 수 있습니다.

```bash
"$HOME/.hermes/hermes-agent/venv/bin/python" -m pip install \
  -r requirements-life-archive.txt
bash scripts/install_life_archive.sh
bash scripts/install_life_routine_skill.sh

"$HOME/.hermes/hermes-agent/venv/bin/python" \
  scripts/set_hermes_env_secret.py LIFE_ARCHIVE_DATABASE_URL

"$HOME/.hermes/hermes-agent/venv/bin/python" \
  scripts/configure_hermes_native.py

hermes gateway restart
hermes memory status
```

`LIFE_ARCHIVE_DATABASE_URL` prompt에는 같은 Supabase session-pooler URL을 넣습니다.
Provider는 이 환경 변수를 config의 local DSN보다 우선합니다.

Primary Hermes에서는 native `life_capture`를 사용하고 remote `capture_event`는 사용하지
않습니다. Secondary Hermes에서는 반대로 remote MCP만 사용합니다. 두 경로는 같은
Supabase에 쓰기 때문에 동시에 사용하면 duplicate memory가 생깁니다.

## MCP Tools

| Tool | 기능 |
| --- | --- |
| `recent_events` | 최근 canonical memory 조회 |
| `recall_events` | FTS, fuzzy, 선택적 pgvector recall |
| `timeline` | topic/project/분쟁의 시간순 history |
| `context_pack` | 다른 agent가 바로 읽을 Markdown context 생성 |
| `project_status` | project history, event type, blocker 요약 |
| `memory_status` | table count와 pgvector version 확인 |
| `capture_event` | append-only durable event 저장 |
| `link_source` | event에 URL/file/evidence reference 연결 |

Update와 delete tool은 의도적으로 제공하지 않습니다. Capture tool에는 password,
API token, private key를 전달하면 안 됩니다.

Remote write를 일시적으로 막으려면 Render에서 다음을 설정하고 redeploy합니다.

```text
HERMES_ALLOW_REMOTE_WRITES=false
```

## Semantic Recall

pgvector schema와 HNSW index는 기본 migration에 포함됩니다. 그러나 embedding API는
기본적으로 꺼져 있습니다. 기존 검증 baseline의 `life_embeddings`도 0건이므로 처음에는
FTS와 fuzzy recall이 동작합니다.

새 capture와 query에 OpenAI embedding을 사용하려면 Render에 다음 secret/config를
추가합니다.

```text
HERMES_EMBEDDING_PROVIDER=http
HERMES_EMBEDDING_API_KEY=<OpenAI API key>
HERMES_EMBEDDING_MODEL=text-embedding-3-small
HERMES_EMBEDDING_DIMENSIONS=1536
HERMES_EMBED_LEGAL_SENSITIVE=false
```

기존 Supabase event를 backfill하려면 신뢰된 Mac에서 실행합니다.

```bash
"$HOME/.hermes/hermes-agent/venv/bin/python" \
  scripts/set_macos_keychain_secret.py hermes-embedding default

export LIFE_ARCHIVE_DATABASE_URL="$SUPABASE_DATABASE_URL"

"$HOME/.hermes/hermes-agent/venv/bin/python" \
  scripts/backfill_life_embeddings.py \
  --dry-run

"$HOME/.hermes/hermes-agent/venv/bin/python" \
  scripts/backfill_life_embeddings.py

unset LIFE_ARCHIVE_DATABASE_URL
```

`legal_sensitive` event는 기본적으로 외부 embedding provider에 보내지 않습니다.
`--include-legal`은 해당 내용을 외부 provider로 보내도 된다고 명시적으로 결정한 경우에만
사용합니다.

## SaaS Integrations

Ultimate Hermes MCP는 memory layer입니다. Linear, Notion, Google Calendar, Drive,
Gmail, Slack 자체의 live API를 대신하지 않습니다. Agent에는 필요한 SaaS MCP/Skill과
Ultimate Hermes를 함께 연결합니다.

| System | 역할 |
| --- | --- |
| Linear | 현재 실행할 project/issue board |
| Notion | 사람이 읽는 decision/document inventory |
| Google Calendar | 일정과 deadline 원본 |
| Google Drive/Gmail | 문서와 communication source |
| Slack | primary Hermes gateway |
| Supabase Life Archive | 장기 history와 모든 durable summary |

외부 SaaS의 원문 전체를 무조건 복제하기보다, durable event와 source URL/external ID를
Life Archive에 남기는 방식이 기본입니다.

## Local Development

Postgres만 시작합니다.

```bash
docker compose up -d postgres
npm ci
npm run db:migrate
```

Node server를 host에서 실행합니다.

```bash
export HERMES_DATABASE_URL='postgres://hermes:hermes@127.0.0.1:55432/hermes'
export HERMES_API_TOKEN='local-test-token'
export HERMES_ALLOW_REMOTE_WRITES=true
npm run build
npm start
```

또는 app profile 전체를 Docker로 실행합니다.

```bash
docker compose --profile app up --build
```

로컬 endpoint는 `http://127.0.0.1:8787/mcp`입니다. HTTP local test에서만 Hermes
configuration helper의 `--allow-http-localhost`를 사용할 수 있습니다.

## HTTP Endpoints

| Method/Path | Auth | 설명 |
| --- | --- | --- |
| `GET /api/v1/health` | 없음 | process liveness |
| `GET /api/v1/ready` | 없음 | DB와 canonical schema readiness |
| `POST /mcp` | Bearer | Streamable HTTP MCP |
| `GET /api/v1/events/recent` | Bearer | 최근 memory |
| `POST /api/v1/recall` | Bearer | recall API |
| `GET /api/v1/timeline` | Bearer | timeline API |
| `POST /api/v1/context-pack` | Bearer | Markdown context |
| `POST /api/v1/events` | Bearer + writes enabled | append-only capture |
| `POST /api/v1/admin/enrollments` | manager Bearer | 일회용 client 설치 명령 생성 |
| `POST /api/v1/enrollments/exchange` | one-time enrollment Bearer | locally-generated key hash 등록 |
| `GET /api/v1/admin/clients` | manager Bearer | client 목록과 last-seen 조회 |
| `POST /api/v1/admin/clients/:id/revoke` | manager Bearer | client 하나만 즉시 폐기 |
| `GET /api/v1/admin/request-logs` | manager Bearer | client 식별 요청 로그 조회 |

`GET /mcp`와 `DELETE /mcp`는 stateless server이므로 `405`를 반환합니다. Client는
Streamable HTTP `POST`를 지원해야 합니다. 구형 HTTP+SSE 전용 client는 업그레이드가
필요합니다.

## Security Model

- API key는 `기기 × Agent`별로 분리하며 server에는 256-bit random key의 SHA-256 hash만 저장합니다.
- indexed key ID로 후보를 찾은 뒤 고정 크기 hash를 constant-time 비교합니다.
- 등록 token은 5~60분만 유효하고 한 번 사용한 뒤 같은 key/hash의 안전한 retry 외에는 재사용할 수 없습니다.
- client별 revoke, last-seen, request/tool attribution을 제공합니다.
- 전환용 `HERMES_API_TOKEN`은 기본적으로 거부되며, 최초 bootstrap에서만
  `HERMES_ACCEPT_LEGACY_API_TOKEN=true`로 명시적으로 허용합니다.
- browser `Origin`은 allowlist에 없으면 `403`입니다.
- Host header도 Render hostname 또는 명시적 allowlist와 일치해야 합니다.
- 잘못된 인증을 source IP별로 집계하고 기본 10회/5분 실패 시 15분 동안 `429`로
  차단합니다. 현재 단일 Render instance에서는 bounded memory store를 사용하며,
  다중 instance 전환 시 중앙 TTL store가 필요합니다.
- Supabase의 `anon`, `authenticated` role은 application table 권한이 revoke됩니다.
- canonical/legacy table과 migration metadata table에 RLS가 활성화됩니다.
- Docker image는 non-root `node` user로 실행됩니다.
- DB credential은 server와 선택적인 primary Hermes에만 둡니다.
- Readiness/health는 공개지만 memory content를 반환하지 않습니다.
- 현재 인증은 single-tenant per-client key입니다. 외부 사용자에게 서비스할 때는 MCP
  OAuth 2.1과 per-user authorization을 추가해야 합니다.

인증 실패 차단 설정, 로그, proxy hop 검증, 다중 instance 전환 기준은
`docs/auth-failure-rate-limiting.md`에 있습니다.

Custom domain을 사용하면 다음 중 하나를 Render에 설정합니다.

```text
HERMES_PUBLIC_BASE_URL=https://memory.example.com
```

또는 여러 host를 허용합니다.

```text
HERMES_ALLOWED_HOSTS=memory.example.com,ultimate-hermes-mcp.onrender.com
```

Browser application에서 직접 MCP를 호출할 때만 정확한 Origin을 추가합니다.

```text
HERMES_ALLOWED_ORIGINS=https://trusted-client.example.com
```

## Operations And Rollback

### Rotate Or Revoke A Client Key

1. 해당 `CLIENT_ID`를 `npm run clients -- revoke CLIENT_ID --auth-agent codex`로 폐기합니다.
2. 같은 기기·Agent 이름으로 새 enrollment command를 만듭니다.
3. 대상 기기에서 command를 실행합니다.
4. `list`의 새 last-seen과 `logs`의 MCP initialize를 확인합니다.

### Roll Back To Local Database

Cloud 검증이 실패해도 로컬 Docker volume은 그대로 남습니다.

1. Primary Hermes의 `LIFE_ARCHIVE_DATABASE_URL`을 local DSN으로 되돌립니다.
2. `hermes gateway restart`를 실행합니다.
3. Remote agents는 cloud MCP를 disable하거나 기존 private endpoint로 되돌립니다.
4. Supabase target을 수정한 뒤 빈 target에서 migration을 다시 수행합니다.

로컬 source volume을 지우거나 덮어쓴 뒤 cloud를 검증하는 순서는 사용하지 않습니다.

### Backups

Supabase의 backup/PITR 정책은 선택한 plan을 확인합니다. 별도 보관이 필요하면 정기적으로
encrypted `pg_dump`를 만들고 DB password와 다른 위치에 보관합니다. Life Archive는
개인, career, legal-sensitive 정보를 포함할 수 있으므로 public bucket에 dump를 두면
안 됩니다.

## Troubleshooting

### `/api/v1/ready`가 실패함

- `HERMES_RUNTIME_DATABASE_URL`이 session-pooler port `5432`인지 확인합니다.
- URL에 `sslmode=verify-full&sslrootcert=/app/certs/prod-ca-2021.crt`가 있는지 확인합니다.
- Supabase password와 project reference를 다시 확인합니다.
- `npm run db:migrate`로 `0007_mcp_client_foreign_key_indexes.sql`까지 적용했는지 확인합니다.
- Render의 `HERMES_RUNTIME_DATABASE_URL`에는 `hermes_runtime` URL만 설정하고, 검증 후
  기존 관리자 `HERMES_DATABASE_URL`을 제거했는지 확인합니다.

### MCP가 `401`을 반환함

`npm run clients -- list`에서 해당 client가 `active`인지 확인합니다. 폐기되었거나 잘못된
key이면 새 enrollment를 발급해 설치기를 다시 실행합니다. 전환 중 공유 token을 쓰는
client라면 `HERMES_ACCEPT_LEGACY_API_TOKEN`도 확인합니다.

### MCP가 `403 Host is not allowed`를 반환함

Custom domain을 `HERMES_PUBLIC_BASE_URL` 또는 `HERMES_ALLOWED_HOSTS`에 추가합니다.

### Hermes가 disconnected라고 표시함

```bash
hermes mcp test ultimate-hermes
hermes mcp configure ultimate-hermes
hermes gateway restart
```

URL이 `/mcp`로 끝나는지, `~/.hermes/.env`에
`MCP_ULTIMATE_HERMES_API_KEY` key가 있는지 확인합니다. 값을 terminal에 출력할 필요는
없습니다.

### Recall은 되지만 semantic 결과가 없음

기본 상태입니다. `memory_status`에서 `embeddings: 0`이면 FTS/fuzzy만 사용합니다.
Embedding 설정과 backfill을 완료한 뒤 semantic recall이 활성화됩니다.

### Migration이 non-empty target을 거부함

중복 restore를 막는 정상 동작입니다. 새 Supabase project/database를 사용하거나 target을
명시적으로 정리한 뒤 재시도합니다. 보존해야 할 target data가 있다면 자동 merge보다
별도 export와 검토가 필요합니다.

## Verification

전체 local verification은 다음 한 명령으로 실행합니다.

```bash
npm run verify
```

개별 명령은 다음과 같습니다.

```bash
npm run typecheck
npm test
npm run test:life-archive
npm run build
docker build -t ultimate-hermes:local .
bash -n scripts/migrate_local_db_to_supabase.sh
```

Migration rehearsal 절차와 검증 기준은
`docs/supabase-cloud-deployment-plan.md`에 기록되어 있습니다.

## Repository Layout

| Path | 역할 |
| --- | --- |
| `src/mcp/` | 공식 SDK 기반 stdio/Streamable HTTP MCP |
| `src/remote/` | canonical Life Archive tool/service layer |
| `src/server/` | authenticated HTTP service |
| `src/db/migrations/` | legacy + canonical + Supabase hardening schema |
| `hermes_plugins/life_archive/` | primary Hermes native memory provider |
| `hermes_skills/life-routine/` | daily memory routing/write policy |
| `scripts/migrate_local_db_to_supabase.sh` | exact local-to-cloud migration |
| `scripts/configure_hermes_remote_mcp.py` | secret-safe Hermes MCP setup |
| `scripts/install_mcp_client.{mjs,py}` | local key generation + one-command client enrollment |
| `scripts/manage_mcp_clients.mjs` | enrollment/list/log/revoke operator CLI |
| `examples/mcp/` | Codex, Claude, Hermes templates |
| `docs/client-key-management.md` | per-device/Agent key 운영과 배포 runbook |
| `docs/ultimate-hermes-security-hardening-manual.html` | Render/Supabase/MCP 보안 강화 실행 매뉴얼 |
| `render.yaml` | Render Blueprint |
| `Dockerfile` | portable production container |

## References

- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP TypeScript SDK server guide](https://ts.sdk.modelcontextprotocol.io/server)
- [Supabase Postgres connections](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Postgres migration](https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
