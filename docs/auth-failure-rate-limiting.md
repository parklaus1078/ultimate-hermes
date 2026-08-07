# Authentication Failure Rate Limiting

Ultimate Hermes는 유효하지 않은 bearer token과 만료·위조된 enrollment token을 source
IP별로 집계합니다. 기본 정책은 5분 안에 10회 실패하면 15분 동안 인증 시도를 차단하는
것입니다.

차단 중인 IP에는 `429 Too Many Requests`, `Retry-After`, `Cache-Control: no-store`를
반환합니다. 임계치 미만의 잘못된 인증에는 `401`을 반환합니다. 유효한 key가 같은 IP에서
사용되더라도 활성 차단을 우회하거나 초기화하지 않습니다.

## 운영 기본값

```text
HERMES_TRUST_PROXY_HOPS=1
HERMES_AUTH_RATE_LIMIT_ENABLED=true
HERMES_AUTH_RATE_LIMIT_MAX_FAILURES=10
HERMES_AUTH_RATE_LIMIT_WINDOW_MS=300000
HERMES_AUTH_RATE_LIMIT_BLOCK_MS=900000
HERMES_AUTH_RATE_LIMIT_MAX_ENTRIES=5000
```

`HERMES_TRUST_PROXY_HOPS=1`은 현재 Render web service의 마지막 proxy hop만 신뢰합니다.
다른 platform이나 proxy chain을 사용하면 실제 hop 수를 검증한 뒤 값을 바꿉니다. 로컬
direct connection의 기본값은 `0`이며 이때 임의의 `X-Forwarded-For`는 source identity로
사용하지 않습니다.

## 로그와 조사

- 임계치 이전 실패: `mcp_auth_rejected`
- 임계치 도달 또는 차단 중 요청: `mcp_auth_rate_limited`
- 기록값: source IP, method, path, 실패 횟수, user-agent
- 기록하지 않는 값: Authorization header, bearer token, request body

`429`가 반복되면 Render log에서 source IP와 user-agent를 확인합니다. 차단은
`HERMES_AUTH_RATE_LIMIT_BLOCK_MS`가 지나면 자동 해제되며 process 재시작 시에도
초기화됩니다.

## 현재 한계와 확장 조건

현재 Render service는 1 instance이므로 process-local bounded memory store를 사용합니다.
최대 entry 수를 넘으면 가장 오래 사용되지 않은 bucket을 제거하므로 IP rotation 공격이
애플리케이션 메모리를 무한히 늘릴 수 없습니다.

Render instance를 2개 이상으로 늘리거나 여러 region에서 운영할 때는 이 store를 Render
Key Value/Redis 같은 중앙 TTL store로 교체하고, custom domain 앞의 Cloudflare WAF에서도
동일한 실패 인증 규칙을 적용합니다. 그 전에는 instance별 counter가 분리되므로 전체
임계치가 instance 수만큼 느슨해집니다.
