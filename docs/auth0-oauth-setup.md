# Life Archive MCP — Auth0 OAuth 설정 설명서

이 문서는 처음 해보는 사람도 위에서 아래로 한 줄씩 따라 할 수 있게 썼습니다.
목표는 ChatGPT와 Codex CLI가 같은 Auth0 계정으로 Life Archive MCP에 로그인하게 만드는
것입니다. Agent에 Client Secret이나 API key를 붙여 넣지 않습니다.

완성되면 다음 규칙이 적용됩니다.

- 로그인 화면과 사용자 계정은 Auth0 하나로 통일됩니다.
- ChatGPT와 Codex는 각각 Auth0에 등록된 안전한 CIMD OAuth client가 됩니다.
- 읽기는 `memory:read`, 쓰기는 `memory:write`, 관리 로그는 `memory:admin` 권한으로 나뉩니다.
- access token은 1시간만 유효합니다.
- rotating refresh token은 최초 로그인 후 최대 180일만 유효합니다.
- 180일 뒤에는 ChatGPT/Codex가 Auth0 OAuth 연결을 다시 시작해야 합니다.
- Auth0 Enterprise를 쓰는 경우에는 MCP 서버의 선택적 이중 검증도 켤 수 있습니다.

> “180일마다 로그인”은 OAuth 승인을 새로 받아야 한다는 뜻입니다. Google 로그인을 Auth0에
> 연결했고 Google 브라우저 세션이 아직 살아 있으면 Google이 비밀번호 입력 화면을 생략할
> 수 있습니다. 비밀번호를 반드시 다시 치게 하고 싶다면 Auth0 Database 사용자만 사용하세요.

## 0. 종이에 적듯이 세 가지 값을 준비하기

아래 예시에서 대문자 부분만 자신의 값으로 바꿉니다.

```text
BASE_URL=https://YOUR-LIFE-ARCHIVE.onrender.com
MCP_URL=https://YOUR-LIFE-ARCHIVE.onrender.com/mcp
AUTH0_ISSUER=https://YOUR-TENANT.REGION.auth0.com/
```

규칙은 세 개뿐입니다.

1. `BASE_URL` 끝에는 `/`를 붙이지 않습니다.
2. `MCP_URL`은 `BASE_URL` 바로 뒤에 `/mcp`를 붙입니다.
3. `AUTH0_ISSUER` 끝에는 `/`를 붙입니다.

이미 Render에 배포되어 있다면 service 화면 위쪽의 URL을 `BASE_URL`로 씁니다. 새로
배포하는 경우에는 Render service를 먼저 만들고 최종 URL을 확인한 다음 Auth0 API를
만드세요. Auth0 API의 Identifier는 만든 뒤 바꾸기 어렵기 때문에 추측한 URL을 쓰면 안 됩니다.

## 1. Auth0 계정과 Tenant 만들기

1. 브라우저에서 [Auth0](https://auth0.com/)를 엽니다.
2. **Sign up**을 누르고 관리자용 계정을 만듭니다.
3. 로그인한 뒤 **Create Tenant**를 누릅니다.
4. Tenant 이름은 알아보기 쉽게 `life-archive-본인이름`처럼 적습니다.
5. Region은 Render와 가까운 곳을 고릅니다. Render가 Singapore라면 가능한 가까운 Region을
   선택합니다.
6. Environment는 **Production**을 고릅니다.
7. **Create**를 눌러 Tenant를 만듭니다.
8. 화면 왼쪽 위 Tenant 선택기에 방금 만든 Tenant 이름이 표시되는지 확인합니다.

Domain은 Tenant Settings에 보이지 않을 수 있습니다. 다음 단계에서 확실한 위치를 사용합니다.

## 2. Domain 확인하고 Auth0 Application 구조 이해하기

### 2-1. Application이 없어도 Domain 찾는 방법

1. 왼쪽 메뉴에서 **Applications → APIs**를 엽니다.
2. Auth0가 기본으로 만들어 둔 **Auth0 Management API**를 누릅니다.
3. **Settings** 탭을 누릅니다.
4. **Identifier** 값을 찾습니다. 모양은 다음과 같습니다.

```text
https://life-archive-kay.us.auth0.com/api/v2/
```

5. 맨 뒤의 `/api/v2/`를 지웁니다. 남은 값이 Auth0 Domain을 포함한 기본 URL입니다.
6. Render에 넣을 `AUTH0_ISSUER`는 끝에 `/`가 있는 다음 모양으로 적습니다.

예를 들어 Domain이 `life-archive-kay.us.auth0.com`이면 다음과 같습니다.

```text
https://life-archive-kay.us.auth0.com/
```

나중에 ChatGPT/Codex Application을 만든 뒤에는 **Applications → Applications → 해당
Application → Settings → Basic Information → Domain**에서도 같은 값을 복사할 수 있습니다.

### 2-2. API와 Application은 서로 다른 것

Auth0 화면에는 이름이 비슷한 두 종류가 있습니다.

| Auth0 항목 | 이 프로젝트에서 의미 |
| --- | --- |
| **API** | 보호할 대상인 배포된 Life Archive MCP |
| **Application** | Life Archive API를 호출하는 ChatGPT 또는 Codex |

ChatGPT와 Codex용 Application은 여기서 빈 Application으로 미리 만들지 않습니다. 7단계와
8단계에서 각 client가 제공하는 CIMD URL을 **Create Application → Import from URL**에 넣으면
Auth0가 callback URL, PKCE, grant type이 맞는 third-party Application을 만들어 줍니다.

일반 **Regular Web Application**, **Native Application**, Client ID 또는 Client Secret을
손으로 만들어 ChatGPT/Codex에 입력하지 마세요. 이 구성의 client ID는 CIMD URL 자체입니다.

### 2-3. Auth0를 MCP용으로 켜기

1. Auth0 왼쪽 메뉴에서 **Settings**를 누릅니다.
2. **General → API Authorization Settings → Default Audience**에서 4단계에 만들 Life
   Archive API의 Identifier인 `MCP_URL`을 선택합니다.
3. 화면 위쪽의 **Advanced** 탭을 누릅니다.
4. 아래로 내려가 **Client ID Metadata Document Registration**을 켭니다.
5. **Resource Parameter Compatibility Profile**을 켭니다.
6. **Include Issuer in Authorization Responses**가 보이면 켭니다.
7. **Save**가 보이면 누릅니다.

이 세 설정은 ChatGPT/Codex가 보내는 CIMD client ID와 `resource=MCP_URL`을 Auth0가
올바르게 이해하게 해 줍니다. `Default Audience`는 Auth0가 `audience`를 생략한 표준 MCP
요청에도 `/userinfo`용 opaque token이 아니라 Life Archive API용 RS256 JWT를 발급하도록
합니다. 이 테넌트의 모든 새 authorization 요청에 적용되므로 Life Archive 전용 Auth0
테넌트에서만 사용하세요. DCR은 이번 버전에서 켜지 않습니다.

Life Archive 서버의 protected-resource metadata는 실제 Auth0 issuer를
`authorization_servers`에 그대로 광고합니다. Auth0의 discovery `issuer`와 authorization
response의 `iss`가 정확히 같아야 ChatGPT/Codex의 OAuth mix-up 방어를 통과합니다. 별도
Client Secret은 필요하지 않습니다.

## 3. 로그인할 사람 만들기

Auth0 기본 이메일/비밀번호 로그인을 쓰는 가장 단순한 방법입니다.

1. **Authentication → Database**를 엽니다.
2. 기본 `Username-Password-Authentication` connection을 엽니다. 없다면 하나 만듭니다.
3. **Settings → Promote Connection to Domain Level**을 켭니다.
4. **Save**를 누릅니다.
5. **User Management → Users → Create User**를 누릅니다.
6. 본인 이메일과 새 비밀번호를 입력합니다.
7. Connection은 방금 확인한 Database connection을 고릅니다.
8. **Create**를 누릅니다.
9. 만들어진 사용자 화면의 `user_id`를 메모합니다. 예: `auth0|abc123...`.

Google 계정으로 로그인하고 싶다면 **Authentication → Social → Google / Gmail** connection을
추가하고 똑같이 **Promote Connection to Domain Level**을 켜도 됩니다. 이것은 Google OAuth가
Auth0 뒤의 로그인 방법이 되는 것이며, MCP 서버의 인증 발급자는 계속 Auth0 하나입니다.

## 4. Life Archive API 만들기

1. **Applications → APIs**를 엽니다.
2. **Create API**를 누릅니다.
3. Name에 `Life Archive MCP`를 입력합니다.
4. Identifier에 0단계에서 적은 `MCP_URL`을 정확히 붙여 넣습니다.
5. Signing Algorithm은 **RS256**을 고릅니다.
6. **Create**를 누릅니다.
7. 만들어진 API의 **Settings**를 엽니다.
8. Token Expiration은 `3600`초로 설정합니다.
9. **Allow Offline Access**를 켭니다.
10. RBAC를 켭니다.
11. **Add Permissions in the Access Token**을 켭니다.
12. JSON Web Token Profile 또는 Token Dialect가 보이면 permissions를 포함하는
    **RFC 9068 Authorization Profile** (`rfc9068_profile_authz`)을 고릅니다.
13. **Application Access Policy**의 User-Delegated Access는
    **Per-app authorization**으로 설정합니다.
14. **Save**를 누릅니다.

## 5. 세 가지 권한과 Owner Role 만들기

1. Life Archive API 안의 **Permissions** 탭을 엽니다.
2. 다음 세 줄을 하나씩 추가합니다.

| Permission | 설명 |
| --- | --- |
| `memory:read` | 기억 읽기와 검색 |
| `memory:write` | 기억 추가와 source 연결 |
| `memory:admin` | 인증 request log 조회 |

3. **User Management → Roles → Create Role**을 누릅니다.
4. Name은 `Life Archive Owner`로 적습니다.
5. 만든 Role의 **Permissions → Add Permissions**를 누릅니다.
6. `Life Archive MCP` API의 세 권한을 모두 선택합니다.
7. Role의 **Users → Add Users**에서 3단계의 본인 사용자를 추가합니다.

## 6. Auth0 브라우저 세션을 180일 이하로 맞추기

180일 재로그인의 기본 장치는 7단계와 8단계에서 각 application에 설정할 rotating refresh
token의 **Maximum Refresh Token Lifetime**입니다. 이 maximum은 같은 token family가
rotation되어도 다시 180일로 늘어나지 않습니다.

1. Auth0의 **Settings → Advanced → Session Expiration**을 찾습니다.
2. Maximum Session Lifetime (Persistent)에 `259200`분을 입력합니다.
3. Maximum Session Lifetime (Non-Persistent)에도 `259200`분을 입력합니다.
4. Idle lifetime은 `259200`분 이하로 둡니다.
5. **Save**를 누릅니다.

`259200`은 `180 × 24 × 60`분입니다. Auth0 plan이 30일까지만 허용해 값을 저장하지 못하면
화면이 허용하는 가장 큰 값을 선택합니다. 180일보다 짧아지는 것이므로 보안상 더 엄격하며,
ChatGPT/Codex의 rotating refresh token은 자신의 180일 한도 안에서 계속 동작합니다.

### 선택 사항: Auth0 Enterprise 서버 이중 검증

Auth0 Enterprise plan에서 refresh exchange의 `event.refresh_token`을 사용할 수 있을 때만 이
단계를 진행합니다. tenant에서 이 기능의 entitlement를 확인할 수 없으면 이 절을 건너뜁니다.
기본 180일 재로그인은 application의 maximum refresh-token lifetime만으로 적용됩니다.

1. 저장소의
   [`auth0/actions/enforce-life-archive-180-day-session.js`](../auth0/actions/enforce-life-archive-180-day-session.js)
   파일을 엽니다.
2. Auth0에서 **Actions → Library → Build Custom**을 누릅니다.
3. Name은 `Life Archive 180 Day Session`, Trigger는 **Login / Post Login**으로 정합니다.
4. 편집기의 예제 코드를 지우고 위 JavaScript 파일 내용을 붙여 넣습니다.
5. Action Secret `LIFE_ARCHIVE_AUDIENCE`의 값에 정확한 `MCP_URL`을 넣습니다.
6. **Deploy**한 다음 **Actions → Triggers → Post Login** Flow에 추가하고 **Apply**를 누릅니다.
7. Render에 다음 두 환경 변수를 추가합니다.

```text
LIFE_ARCHIVE_AUTH0_SESSION_STARTED_AT_CLAIM=<MCP_URL>/session_started_at
LIFE_ARCHIVE_AUTH0_MAX_SESSION_AGE_SECONDS=15552000
```

이 Action은 access token에 최초 login 시각을 넣고, 서버는 그 claim이 180일을 넘었는지 다시
검사합니다. 지원되지 않는 Auth0 plan에서 Action이나 claim 환경 변수만 억지로 켜면 refresh
로그인이 실패할 수 있습니다. 두 설정을 함께 켜거나, 둘 다 끈 상태로 사용하세요.

## 7. ChatGPT용 Auth0 Application 만들기

ChatGPT 화면의 메뉴 이름은 계정 종류에 따라 **Apps**, **Connectors**, 또는 **Apps &
Connectors**로 조금 다를 수 있습니다. 중요한 것은 ChatGPT가 보여 주는 정확한 CIMD URL과
redirect URL을 사용하는 것입니다.

이 단계에서 첫 번째 실제 Auth0 Application을 만듭니다. 일반 Application type을 고르는
화면이 아니라 **Import from URL**을 사용해야 합니다.

1. ChatGPT에서 **Settings**를 엽니다.
2. **Apps / Connectors → Advanced settings**에서 Developer mode를 켭니다.
3. **Create** 또는 **Add custom connector**를 누릅니다.
4. 이름은 `Life Archive`로 적습니다.
5. MCP Server URL에는 0단계의 `MCP_URL`을 붙여 넣습니다.
6. Authentication은 **OAuth**를 고릅니다.
7. 화면에 표시되는 **Client ID Metadata Document URL**과 **Redirect URL**을 메모합니다.
8. Auth0로 돌아가 **Applications → Applications → Create Application → Import from URL**을
   누릅니다.
9. ChatGPT가 보여 준 CIMD URL을 붙여 넣습니다. `https://chatgpt.com/oauth/client.json`일
   수도 있고 callback ID가 포함된 URL일 수도 있습니다. 손으로 추측하지 말고 화면의 전체
   값을 그대로 사용합니다.
10. **Preview**를 누릅니다.
11. 빨간 validation error가 없으면 **Create**를 누릅니다.

생성이 끝나면 **Applications → Applications** 목록에 ChatGPT 이름의 Application이 생깁니다.
이 Application은 third-party client이며 Client Secret을 ChatGPT에 복사하지 않습니다.

12. **Applications → APIs → Life Archive MCP → Application Access**를 엽니다.
13. 방금 만든 ChatGPT application의 **Edit**을 누릅니다.
14. **User-Delegated Access → Grant Access**를 켭니다.
15. `memory:read`, `memory:write`, `memory:admin`을 선택하고 **Save**를 누릅니다.
16. 방금 만든 application의 **Settings / Advanced Settings**를 엽니다.
17. Grant Types에 `Authorization Code`와 `Refresh Token`이 있는지 확인합니다.
18. Refresh Token Rotation을 켭니다.
19. Rotation Overlap Period는 `10`초처럼 짧게 둡니다.
20. Idle Refresh Token Lifetime을 켜고 `15552000`을 입력합니다.
21. Maximum Refresh Token Lifetime을 켜고 `15552000`을 입력합니다.
22. **Save**를 누릅니다.
23. ChatGPT로 돌아가 connector 생성을 마치고 **Connect**를 누릅니다.
24. Auth0 로그인 화면에서 3단계의 사용자로 로그인합니다.
25. 권한 동의 화면이 나오면 승인합니다.

`15552000`은 `180 × 24 × 60 × 60`초입니다. Client Secret을 ChatGPT 채팅창이나 설정에
입력하는 단계는 없습니다. lifetime을 바꾸기 전에 이미 연결했다면 ChatGPT에서 기존 연결을
끊고 다시 연결해 새 refresh-token family를 발급받습니다.

## 8. Codex CLI용 Auth0 Application 만들기

먼저 Terminal에서 다음 명령을 실행합니다. `MCP_URL` 부분은 실제 URL로 바꿉니다.

```bash
codex mcp add life-archive \
  --url "https://YOUR-LIFE-ARCHIVE.onrender.com/mcp" \
  --oauth-resource "https://YOUR-LIFE-ARCHIVE.onrender.com/mcp"
```

이제 CIMD 로그인을 시작합니다.

```bash
codex mcp login life-archive \
  --scopes memory:read,memory:write,memory:admin,offline_access \
  --oauth-client-registration cimd
```

처음에는 Auth0에 Codex의 CIMD client가 아직 없어서 `invalid_client`가 나오는 것이
정상입니다. Life Archive가 실제 Auth0 issuer를 표준 방식으로 광고하면 현재 Codex CLI는
다음 안정형 CIMD URL을 사용합니다.

```text
https://chatgpt.com/oauth/codex/client.json
```

이 URL로 두 번째 Auth0 Application을 다음 순서로 딱 한 번 만듭니다. Codex도 일반
Application type을 직접 선택하지 않습니다.

1. Codex가 출력하거나 브라우저 주소의 `client_id=`에 넣은 CIMD URL을 복사합니다.
2. 찾기 어렵다면 Auth0의 **Monitoring → Logs**에서 방금 실패한 기록을 열고 상세 JSON의
   `client_id`를 복사합니다.
3. `client_id`가 정확히 `https://chatgpt.com/oauth/codex/client.json`인지 확인합니다.
4. callback별 `https://chatgpt.com/oauth/codex/<callback_id>/client.json`이 보인다면 서버가
   아직 MCP origin을 authorization server로 광고하는 예전 버전일 수 있습니다. 먼저
   10단계에서 `authorization_servers`가 실제 Auth0 issuer인지 확인합니다.
5. Auth0의 **Applications → Applications → Create Application → Import from URL**을 엽니다.
6. 복사한 URL을 붙여 넣고 **Preview → Create**를 누릅니다.

생성이 끝나면 **Applications → Applications** 목록에 Codex용 third-party Application이
생깁니다. External Client ID는 위 안정형 CIMD URL이고, callback은
`http://127.0.0.1/callback`과 `http://localhost/callback`입니다.

7. **Applications → APIs → Life Archive MCP → Application Access**에서 Codex application을
   찾습니다.
8. **Edit → User-Delegated Access → Grant Access**를 켭니다.
9. `memory:read`, `memory:write`, `memory:admin`을 선택하고 저장합니다.
10. Codex application의 Refresh Token Rotation을 켜고 maximum lifetime은 `15552000`,
    idle lifetime은 `15551999`, overlap은 `60`초로 설정합니다.
11. 기존 Codex 연결이 있었다면 `codex mcp logout life-archive`로 먼저 끊습니다.
12. 위의 `codex mcp login` 명령을 다시 실행합니다.
13. Auth0에서 로그인하고 동의합니다.
14. 다음 명령으로 연결을 확인합니다.

```bash
codex mcp list
```

중요: Auth0의 authorization-server metadata에는 보통 OIDC scope만 보이므로 Codex가
Life Archive의 `memory:*` scope를 자동으로 요청하지 못할 수 있습니다. 반드시 위 명령처럼
`--scopes memory:read,memory:write,memory:admin,offline_access`를 명시합니다. 로그인이
성공했는데 tool 호출이 `Insufficient scope`로 실패하면 다음 순서로 다시 로그인합니다.

```bash
codex mcp logout life-archive
codex mcp login life-archive \
  --scopes memory:read,memory:write,memory:admin,offline_access \
  --oauth-client-registration cimd
```

브라우저로 열리는 `/authorize` URL의 `scope=`에도 세 `memory:*` scope와
`offline_access`가 실제로 들어 있는지 확인합니다.

## 9. Render에 Auth0 값 넣기

1. Render Dashboard에서 `life-archive-mcp` service를 엽니다.
2. **Environment**를 엽니다.
3. 다음 값을 추가하거나 바꿉니다.

| Key | Value |
| --- | --- |
| `LIFE_ARCHIVE_AUTH0_ISSUER` | 2-1단계에서 확인한 `AUTH0_ISSUER` |
| `LIFE_ARCHIVE_AUTH0_AUDIENCE` | 0단계의 `MCP_URL` |
| `LIFE_ARCHIVE_AUTH0_ALLOWED_SUBJECTS` | 3단계의 Auth0 `user_id` |
| `LIFE_ARCHIVE_AUTH0_MAX_ACCESS_TOKEN_LIFETIME_SECONDS` | `3600` |

`LIFE_ARCHIVE_AUTH0_ALLOWED_SUBJECTS`에 여러 사용자를 허용하려면 쉼표로 구분합니다. 비워 두면
Role/permission을 가진 tenant 사용자를 허용합니다. 개인 archive라면 본인 `user_id`를 넣는
것이 안전합니다.

6단계의 선택적 Enterprise Action을 켠 경우에만
`LIFE_ARCHIVE_AUTH0_SESSION_STARTED_AT_CLAIM=<MCP_URL>/session_started_at`와
`LIFE_ARCHIVE_AUTH0_MAX_SESSION_AGE_SECONDS=15552000`도 추가합니다.

4. 예전 `HERMES_API_TOKEN`과 `HERMES_ACCEPT_LEGACY_API_TOKEN`이 있으면 제거합니다.
5. **Save Changes**를 누르고 새 deploy가 끝날 때까지 기다립니다.

## 10. 배포가 잘 되었는지 확인하기

Terminal에서 URL을 실제 값으로 바꾸어 실행합니다.

```bash
export LIFE_ARCHIVE_BASE_URL="https://YOUR-LIFE-ARCHIVE.onrender.com"

curl -fsS "$LIFE_ARCHIVE_BASE_URL/api/v1/health"
curl -fsS "$LIFE_ARCHIVE_BASE_URL/api/v1/ready"
curl -fsS "$LIFE_ARCHIVE_BASE_URL/.well-known/oauth-protected-resource"
curl -i -X POST "$LIFE_ARCHIVE_BASE_URL/mcp" \
  -H 'Content-Type: application/json' \
  --data '{}'
curl -fsS -X POST "$LIFE_ARCHIVE_BASE_URL/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

정상 결과는 다음과 같습니다.

- health 응답에 `"ok":true`가 보입니다.
- ready 응답에 `"database":"ready"`가 보입니다.
- OAuth metadata의 `resource`가 정확한 `MCP_URL`입니다.
- protected-resource metadata의 `authorization_servers`는 Auth0 Domain과 정확히 같은
  `https://YOUR_TENANT.REGION.auth0.com/`입니다. 끝의 `/`도 Auth0 discovery의 `issuer`와
  일치해야 합니다.
- Auth0 **Settings → General → Default Audience**가 정확한 `MCP_URL`입니다.
- token 없는 `/mcp` 요청은 일부러 `401`을 반환합니다.
- `401` 응답의 `WWW-Authenticate`에 `resource_metadata=`가 있습니다.
- 로그인하지 않은 `tools/list`에는 도구 이름과 최상위 `securitySchemes`가 보이지만 기억 데이터는 나오지 않습니다.

마지막으로 ChatGPT에서 `memory_status` 또는 `recent_events`를 실행하고, Codex에서도 Life
Archive의 최근 memory 조회를 요청합니다.

ChatGPT에서 계정 연결이 완료된 뒤에는 새 대화를 열고 입력창의 **+ → More → Developer mode**에서
**Life Archive**를 대화의 도구로 선택합니다. `최근 기억 보여줘`처럼 읽기 요청을 보내고, 도구
호출 확인창이 나오면 내용과 권한을 확인한 뒤 승인합니다. 이 단계는 계정 연결이 성공한 다음에만
가능합니다. 계정 추가 화면에서 `Cannot add this account`가 뜬다면 대화 선택 문제가 아니므로
11단계의 OAuth/MCP 점검을 먼저 진행합니다.

## 11. 자주 생기는 문제

### Auth0 로그인은 성공했는데 ChatGPT에 `Cannot add this account`가 뜸

- 비밀번호를 다시 입력할 필요는 없습니다. Auth0의 **Monitoring → Logs**에 ChatGPT의
  `Success Login`과 `Success Exchange`가 있는지 먼저 확인합니다.
- 위 10단계의 익명 `tools/list` 요청이 `200`인지 확인합니다. 각 도구의 최상위
  `securitySchemes`에 `memory:read` 또는 `memory:write`가 보여야 ChatGPT가 필요한 권한을
  요청할 수 있습니다.
- Render 로그에서 `mcp_authorization_rejected`를 찾습니다. `insufficient_scope`와
  `grantedScopeCount:0`이면 새로 연결하면서 권한을 다시 승인해야 합니다.
  `origin_not_allowed`면 `HERMES_ALLOWED_ORIGINS` 설정을 확인합니다.
- `auth0_jwt_verify_failed`의 `tokenShape.segments`가 `1`이면 Auth0의 opaque token입니다.
  Auth0 **Settings → General → Default Audience**가 `MCP_URL`인지 확인한 뒤, ChatGPT의
  기존 Life Archive 계정 연결을 끊고 다시 연결합니다. 서버는 opaque token을 API token으로
  받아들이지 않습니다.
- `Authorization server issuer mismatch`가 뜨면 protected-resource metadata의
  `authorization_servers`가 실제 Auth0 discovery의 `issuer`와 글자 단위로 같은지 확인합니다.
  MCP 서버 주소를 authorization server로 광고하면 Auth0가 반환한 `iss`와 달라 Codex가
  callback을 거부합니다.
- 서버 수정 후에도 이전 연결 시도를 재사용한다면 ChatGPT에서 해당 Life Archive 연결을
  끊고 다시 연결합니다. 기존 access token에 새 scope가 자동 추가되지는 않습니다.

### `invalid_client`

- Auth0에 등록한 CIMD URL이 ChatGPT/Codex가 보낸 `client_id`와 한 글자라도 다릅니다.
- Auth0 application을 지우기 전에, **Monitoring → Logs**의 실제 `client_id`를 다시 복사합니다.
- Auth0 **Settings → Advanced → Client ID Metadata Document Registration**이 켜졌는지 봅니다.

### `access_denied` 또는 permission 오류

- API의 **Application Access**에서 해당 ChatGPT/Codex CIMD application에
  User-Delegated Access를 허용했는지 봅니다.
- 사용자에게 `Life Archive Owner` Role을 붙였는지 봅니다.
- access token의 `scope`에 요청한 `memory:*` scope가 들어오는지 봅니다. 서버는 더 넓은
  Auth0 `permissions` claim을 OAuth client에게 위임된 scope로 간주하지 않습니다.
- Codex 로그인이 성공했는데 `Insufficient scope`가 나오면 8단계의 `--scopes` 명령으로
  logout/login하고, Auth0 동의 화면에 세 `memory:*` 권한이 표시되는지 확인합니다.

### 로그인은 되었는데 MCP가 `401`을 반환함

- Render의 issuer와 audience가 Auth0 Domain/API Identifier와 정확히 같은지 봅니다.
- access token lifetime이 3600초 이하인지 봅니다.
- 선택적 Enterprise Action을 켰다면 Action이 Post Login Flow에 들어갔는지, Action Secret과
  Render의 session-start claim 이름이 정확히 같은지 봅니다.
- 설정을 바꾼 뒤에는 ChatGPT/Codex 연결을 끊고 다시 연결합니다.

### 한 시간마다 로그인을 요구함

- API의 **Allow Offline Access**가 켜졌는지 봅니다.
- application에 Refresh Token grant가 있는지 봅니다.
- login scope에 `offline_access`가 포함됐는지 봅니다.
- refresh token이 rotating/expiring으로 설정됐는지 봅니다.

### 정확히 180일 뒤 비밀번호 화면이 안 나옴

OAuth refresh token은 만료되어 새 authorization flow가 시작된 상태일 수 있습니다. Google 같은
상위 로그인 제공자의 세션이 살아 있으면 비밀번호 입력은 생략될 수 있습니다. 실제 비밀번호
재입력까지 원하면 Auth0 Database connection을 사용하고 Auth0 tenant의 세션 absolute lifetime을
180일 이하로 둡니다. Auth0 plan이 30일까지만 허용하면 30일을 선택해도 됩니다. 이것은 180일보다
더 엄격한 설정입니다.

## 12. 설정 완료 체크리스트

- [ ] Auth0 tenant를 만들었다.
- [ ] Auth0 Management API Identifier에서 Domain과 Issuer를 확인했다.
- [ ] CIMD, resource parameter, issuer response 설정을 켰다.
- [ ] 로그인 connection을 Domain Level로 올렸다.
- [ ] API Identifier가 정확한 `MCP_URL`이다.
- [ ] Settings → General의 Default Audience가 정확한 `MCP_URL`이다.
- [ ] RS256, 1시간 access token, offline access, RBAC를 켰다.
- [ ] 세 권한과 Owner Role을 만들고 사용자에게 붙였다.
- [ ] Auth0 브라우저 SSO session lifetime도 180일 이하로 두었다.
- [ ] ChatGPT CIMD를 `Import from URL`로 Application으로 만들고 user-delegated permission을 주었다.
- [ ] Codex CIMD를 `Import from URL`로 Application으로 만들고 user-delegated permission을 주었다.
- [ ] 두 application의 rotating refresh token 최대/idle lifetime이 `15552000`이다.
- [ ] lifetime 설정 후 기존 연결을 끊고 새로 로그인했다.
- [ ] Render에 issuer, audience, subject, 1시간 값을 넣었다.
- [ ] (Enterprise 선택) Action과 서버 session-start claim을 함께 켰다.
- [ ] metadata/401 smoke test와 실제 memory tool 호출을 확인했다.

## 공식 참고 문서

- [OpenAI Apps SDK MCP authentication](https://developers.openai.com/apps-sdk/build/auth)
- [Auth0: MCP client의 `resource`를 API `audience`에 연결하기](https://auth0.com/blog/adding-ui-auth0-secured-mcp-server-skybridge/#why-auth0-needs-one-extra-step)
- [Auth0: ChatGPT에서 원격 MCP 연결 후 대화에 추가하기](https://auth0.com/blog/add-remote-mcp-server-chatgpt/#Step-4--Interact-with-Your-Remote-MCP-Server-in-a-Conversation)
- [Codex MCP OAuth client registration](https://learn.chatgpt.com/docs/extend/mcp#oauth-client-registration)
- [Auth0 manual CIMD registration](https://auth0.com/docs/get-started/auth0-overview/create-applications/register-applications-with-cimd)
- [Auth0 third-party application setup](https://auth0.com/docs/get-started/applications/third-party-applications/configure-third-party-applications)
- [Auth0 refresh token expiration](https://auth0.com/docs/secure/tokens/refresh-tokens/configure-refresh-token-expiration)
- [Auth0 refresh token rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)
- [Auth0 Support: `event.refresh_token` Enterprise requirement](https://support.auth0.com/center/s/article/find-requested-scopes-in-actions-for-refresh-token-client-credential-exchange-or-resource-owner-password-grant)
