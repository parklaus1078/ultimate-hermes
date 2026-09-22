# Backlog — CI와 무인 Agent 인증

## 현재 결정

현재 release는 사람을 대신하는 ChatGPT/Codex 연결만 지원한다. 모든 interactive client는
Auth0 Authorization Code + PKCE + CIMD로 로그인한다. API key와 기존 MCP client key 발급
경로는 운영 인증으로 사용하지 않는다.

CI pipeline, cron worker, 서버형 Agent처럼 브라우저 로그인을 할 수 없는 workload는 이번
release 범위 밖이다. 사람의 180일 refresh token을 CI secret으로 복사하는 방식도 지원하지
않는다.

## 왜 별도 설계가 필요한가

- ChatGPT MCP 연결은 client credentials, service account, custom API key를 지원하지 않는다.
- Auth0 Machine-to-Machine client credentials는 service-to-service에는 적합하지만 사용자
  대신 동작하는 ChatGPT 연결과 의미가 다르다.
- CI credential은 사용자 refresh token보다 짧고, 자동 회전되며, workload identity에 묶여야
  한다.
- 개인 memory write 권한은 supply-chain compromise 때 피해가 크므로 read/write를 분리해야
  한다.

## 후보 아키텍처

### A. Auth0 M2M client credentials

GitHub Actions 외의 고정된 backend/worker부터 적용한다.

- Auth0에 confidential M2M application을 별도로 만든다.
- audience는 현재 Life Archive MCP API를 재사용한다.
- 사용자 scope와 구분된 `memory:read:service`, `memory:write:service`를 도입한다.
- `sub`가 user가 아닌 client임을 audit log에 명시한다.
- client secret은 CI secret store에 보관하고 정기 회전한다.

장점은 Auth0 하나를 유지하는 것이다. 단점은 장기 client secret이 생긴다는 것이다.

### B. Workload identity federation

GitHub Actions OIDC, cloud workload identity, SPIFFE/SPIRE 같은 외부 identity를 Auth0 또는
별도 token broker에서 짧은 Life Archive token으로 교환한다.

- 저장된 장기 secret이 없다.
- repository, branch, workflow, environment claim을 정책으로 제한한다.
- 5~15분짜리 access token만 발급한다.
- production write는 protected environment와 승인된 workflow에만 허용한다.

이 방식이 장기 목표다. Auth0 tenant/plan이 필요한 token-exchange 기능을 제공하는지 먼저
검증한다.

### C. OpenAI hosted Agent 전용 credential vault

OpenAI hosted Agent가 공식적으로 MCP service credential 또는 workload identity를 제공할 때
검토한다. 사용자 OAuth refresh token을 임의로 복제하지 않고, platform vault가 제공하는
표준 identity만 사용한다.

## 구현 단계

### Phase 1 — 설계와 위협 모델

- workload 종류를 `github-actions`, `scheduled-worker`, `openai-hosted-agent`로 분류한다.
- 각 workload의 read/write 필요성을 기록한다.
- 사람 token과 machine token을 JWT claim으로 확실히 구분한다.
- issuer/audience validation, replay, secret theft, fork PR 공격을 threat model에 넣는다.

### Phase 2 — 최소 read-only pilot

- machine 전용 `memory:read:service` permission을 추가한다.
- 한 개의 비-production CI workflow만 연결한다.
- token lifetime은 최대 15분으로 제한한다.
- audit row에 client ID, workload type, repository/environment claim을 저장한다.
- subject/client allowlist와 rate limit을 별도로 둔다.

### Phase 3 — secretless federation

- GitHub Actions OIDC token의 issuer, audience, repository, ref, environment를 검증한다.
- Auth0 또는 broker에서 짧은 access token으로 교환한다.
- long-lived client secret pilot을 제거한다.
- key/credential rotation과 incident revoke runbook을 만든다.

### Phase 4 — 제한된 write

- append-only `memory:write:service`를 별도 permission으로 추가한다.
- protected branch/environment에서만 발급한다.
- event에 `createdByProfile`, workflow run ID, commit SHA를 강제로 기록한다.
- delete/update/admin은 machine principal에 주지 않는다.

## 완료 조건

- CI 저장소에 사용자 access/refresh token 또는 Auth0 관리자 secret이 없다.
- fork PR은 production Life Archive token을 받을 수 없다.
- machine token은 15분 이내에 만료된다.
- 사용자 token과 machine token이 server와 audit log에서 명확히 구분된다.
- workload 하나를 폐기해도 사용자 ChatGPT/Codex OAuth 연결은 영향을 받지 않는다.
- 발급, rotation, revoke, incident response가 자동 테스트와 runbook으로 검증된다.

## 이번 release에서 일부러 하지 않는 것

- ChatGPT에 client secret/API key 붙여 넣기
- 사람의 180일 refresh token을 CI secret으로 재사용하기
- Auth0 DCR을 인터넷 전체에 열기
- `memory:admin` 또는 destructive database 권한을 무인 Agent에 주기
