# MCP Client Key 운영 Runbook

Ultimate Hermes는 `기기 × Agent`를 하나의 client identity로 취급합니다. 같은 기기의
Codex, Claude Code, Hermes Agent에는 각각 다른 key를 발급합니다. 서버 DB에는 원문
key가 아니라 SHA-256 hash만 저장되고, 모든 인증 요청은 client ID와 연결됩니다.

## 배포 순서

새 server build는 migration `0007_mcp_client_foreign_key_indexes.sql`까지 요구합니다. 따라서 아래 순서를
지켜 기존 Render 서비스의 중단을 피합니다.

1. migration 전용 관리자 DSN으로 `npm run db:migrate`를 실행합니다.
2. `mcp_clients`, `mcp_enrollment_tokens`, `mcp_request_audit` table과 RLS policy를 확인합니다.
3. 새 Render build를 배포합니다.
4. `/api/v1/ready`와 기존 bootstrap token의 MCP initialize를 확인합니다.
5. 최소 한 개의 manager client를 만들고 새 key로 management API를 확인합니다.
6. 나머지 기기·Agent를 각각 등록합니다.
7. `HERMES_ACCEPT_LEGACY_API_TOKEN=false`로 바꾸고 redeploy합니다.

공개 `render.yaml`은 이 값을 `sync: false`로 선언합니다. Render는 기존 Blueprint를
갱신할 때 `sync: false` 변수를 무시하므로 repository sync가 운영값을 다시 `true`로
되돌리지 않습니다. 최초 Blueprint 생성 시에만 `true`를 입력하고, manager 확인 후
Render Dashboard에서 `false`로 바꿉니다. 애플리케이션의 미설정 기본값도 `false`입니다.

DB migration은 DDL 권한이 있는 `HERMES_MIGRATION_DATABASE_URL`로만 실행합니다. Render에는
기존의 제한된 `hermes_runtime` DSN만 유지합니다.

## 최초 manager client 만들기

repository가 있는 관리 컴퓨터에서 연결할 Agent 하나만 지정합니다.

```bash
export ULTIMATE_HERMES_URL="https://ultimate-hermes-mcp.onrender.com"
npm run connect -- codex
```

manager key가 아직 없으면 CLI가 `Admin token:`을 묻습니다. Render Dashboard의 service
**Environment → `HERMES_API_TOKEN` → Reveal/Copy**에서 복사한 값을 붙여 넣습니다. 입력은
숨겨지고 저장되지 않습니다. 활성 manager가 하나도 없으면 이 첫 client에 관리 권한을
자동 부여하며, key 생성·Agent 설정·MCP 검증까지 같은 명령 안에서 끝납니다.

이 bootstrap 입력은 `HERMES_ACCEPT_LEGACY_API_TOKEN=true`인 최초 전환 기간에만 동작합니다.
이미 다른 컴퓨터에 manager가 있고 legacy token을 차단했다면 그 manager 컴퓨터에서 아래
`npm run pair`를 사용합니다.

```bash
npm run clients -- list
```

CLI는 `~/.codex/config.toml`, `~/.claude.json`, `~/.hermes/.env` 순서로 manager key를
찾되 출력하지 않습니다. 특정 Agent를 강제로 선택할 때만 `--auth-agent codex`,
`--auth-agent claude`, `--auth-agent hermes`를 사용합니다. 일회성 명시적 override가
필요할 때만 `ULTIMATE_HERMES_ADMIN_TOKEN` 환경 변수를 사용합니다.

## 일반 client 추가

같은 컴퓨터의 다른 Agent는 key를 직접 다루지 않고 바로 연결합니다.

```bash
npm run connect -- claude
npm run connect -- hermes
```

다른 컴퓨터에는 manager 컴퓨터에서 pairing 명령을 만듭니다.

```bash
npm run pair -- codex --device "office-mac"
npm run pair -- hermes --device "home-linux"
```

출력된 installer 한 줄만 대상 컴퓨터에서 실행합니다. 명령을 잘못된 채널에 보냈다면
사용하지 말고 만료를 기다리거나 새 명령을 만듭니다. 등록 코드는 기본 10분,
`--expires 5`부터 `--expires 60`까지 설정할 수 있습니다.

`pair`는 최초 manager 권한을 자동 부여하지 않습니다. 추가 관리 컴퓨터가 필요한 경우에만
대상을 확인한 뒤 `--admin`을 명시합니다.

## 조회와 사고 대응

```bash
npm run clients -- list
npm run clients -- logs --limit 100
npm run clients -- revoke mcpcli_xxxxx
```

분실한 기기는 해당 client 하나만 revoke합니다. 다른 기기와 Agent key는 바꿀 필요가
없습니다. `lastSeenAt`, `source_ip`, `user_agent`, `operation`, `status_code`, 응답의
`X-Hermes-Request-Id`를 함께 확인하면 어떤 client에서 어떤 MCP tool이 호출됐는지
추적할 수 있습니다. IP는 proxy metadata이므로 인증 identity가 아니라 조사 보조 정보로만
사용합니다.

로그에는 Authorization header, raw API key, enrollment token, MCP request body를 저장하지
않습니다. `operation`에는 JSON-RPC method와 `tools/call`의 tool 이름만 저장합니다.

## 복구와 rollback

- 새 installer가 실패하면 enrollment가 성공하기 전까지 기존 Agent config로 복구합니다.
- enrollment 성공 후 MCP 검증만 실패한 경우에는 새 key와 config를 보존하므로 네트워크
  문제를 해결한 뒤 다시 연결할 수 있습니다.
- manager key를 모두 잃었고 legacy token을 아직 허용한다면 bootstrap token으로 새
  manager를 만듭니다.
- legacy token을 이미 차단한 뒤 manager를 모두 잃었다면, Render에서 잠시
  `HERMES_ACCEPT_LEGACY_API_TOKEN=true`로 되돌려 새 manager를 등록한 후 다시 차단합니다.
- `mcp_clients.status`를 SQL로 직접 고치지 않습니다. 관리 API와 audit trail을 사용합니다.
