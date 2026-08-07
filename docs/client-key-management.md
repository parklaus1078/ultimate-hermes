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

DB migration은 DDL 권한이 있는 `HERMES_MIGRATION_DATABASE_URL`로만 실행합니다. Render에는
기존의 제한된 `hermes_runtime` DSN만 유지합니다.

## 최초 manager client 만들기

```bash
export ULTIMATE_HERMES_URL="https://ultimate-hermes-mcp.onrender.com"
printf 'Bootstrap token: '
IFS= read -r -s ULTIMATE_HERMES_ADMIN_TOKEN
printf '\n'
export ULTIMATE_HERMES_ADMIN_TOKEN

npm run clients -- create --device "admin-mac" --agent codex --admin
```

출력된 command는 target인 `admin-mac`에서 실행합니다. 완료 후 bootstrap token을 현재
shell에서 제거합니다.

```bash
unset ULTIMATE_HERMES_ADMIN_TOKEN
npm run clients -- list --auth-agent codex
```

`--auth-agent codex`는 `~/.codex/config.toml`의 Ultimate Hermes key를 읽되 출력하지
않습니다. Claude는 `--auth-agent claude`, Hermes는 `--auth-agent hermes`를 사용합니다.

## 일반 client 추가

각 명령은 등록 코드가 포함된 installer 한 줄을 출력합니다.

```bash
npm run clients -- create --auth-agent codex --device "office-mac" --agent codex
npm run clients -- create --auth-agent codex --device "office-mac" --agent claude
npm run clients -- create --auth-agent codex --device "home-linux" --agent hermes
```

명령을 잘못된 채널에 보냈다면 사용하지 말고 만료를 기다리거나 새 명령을 만듭니다.
등록 코드는 기본 10분, `--expires 5`부터 `--expires 60`까지 설정할 수 있습니다.

## 조회와 사고 대응

```bash
npm run clients -- list --auth-agent codex
npm run clients -- logs --auth-agent codex --limit 100
npm run clients -- revoke mcpcli_xxxxx --auth-agent codex
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
