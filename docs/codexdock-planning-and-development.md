# CodexDock 기획 및 개발 계획

상세 개발 스펙, TODO, QA 기준은 `docs/codexdock-development-spec-and-todo.md`를 기준으로 한다.

다음 개발 실행 계획은 `docs/codexdock-owner-scoped-sdk-implementation-plan.md`를 기준으로 한다. 이 문서는 사용자별 local Codex worker routing, host SDK API, endpoint discovery, OpenAI-inspired generation API, artifact upload 계획을 합친다.

텍스트 생성, JSON/object 생성, 이미지/파일 생성의 API 표면은 `docs/openai-api-inspired-generation-plan.md`를 기준으로 OpenAI API의 Responses/Structured Outputs 개념을 참고하되, CodexDock의 async worker 구조에 맞게 설계한다.

## 1. 제품 정의

CodexDock은 서비스가 OpenAI API를 직접 호출하는 대신, AI로 처리할 작업을 CodexDock SDK에 전달하고 각 사용자의 로컬 Codex 실행 환경에서 그 작업을 수행하게 해주는 SDK + CLI worker입니다.

CodexDock은 `/v1/chat/completions` 같은 동기식 모델 API 호환 프록시가 아닙니다. 앱이 "이 입력에 대한 모델 응답 하나"를 요청하는 구조가 아니라, "AI를 통해 이 작업을 수행하고 결과를 돌려달라"는 요청을 만들고, 연결된 로컬 워커가 해당 요청을 실행한 뒤 결과를 다시 돌려주는 비동기 invoke layer입니다.

웹서버 안에 설치된 CodexDock SDK는 요청 수신, 사용자별 로컬 worker 연결, 실행 요청 전달, 결과 응답을 담당합니다. 로컬 워커는 해당 사용자의 기기에서 Codex SDK 또는 Codex CLI를 통해 실제 작업을 수행합니다. 웹서버가 로컬 파일시스템이나 Codex에 직접 접근하지 않고, 사용자 소유 로컬 워커가 웹서버와 Codex 사이의 안전한 중계자 역할을 합니다.

핵심 문장:

> Dock your local Codex to your app.

보조 설명:

> Use local Codex as your app's AI runtime, instead of calling the OpenAI API directly.

## 2. 목표

- 앱 또는 웹 서비스가 OpenAI API 호출 대신 CodexDock SDK로 AI 작업을 요청한다.
- CodexDock SDK가 요청한 사용자에게 연결된 로컬 CodexDock CLI worker로 요청을 전달한다.
- CodexDock CLI는 host app의 사용자/account/workspace owner에 묶인 worker identity를 가진다.
- 작업 실행은 사용자의 로컬 Codex 로그인/설정/권한을 사용해 Codex SDK 또는 Codex CLI로 수행한다.
- 진행률, 로그, 결과물, 생성 파일을 CodexDock SDK를 통해 앱에 반환한다.
- 웹서버는 OpenAI API key를 보관하거나 AI 실행을 직접 하지 않고, 연결된 로컬 worker로 요청을 중계한다.

## 2.1 사용자별 실행 모델

CodexDock의 기본 실행 단위는 서비스 전체가 아니라 owner다. owner는 host app이 선택한 식별자이며 보통 `userId`, `accountId`, `workspaceId` 중 하나다.

기본 모델:

- 사용자가 웹에서 자신의 계정으로 local Codex worker를 연결한다.
- worker token은 특정 host app, owner, worker에 묶인다.
- 사용자가 AI 기능을 실행하면 invocation은 같은 owner scope로 저장된다.
- `worker/next`는 해당 worker의 owner scope에 속한 pending invocation만 반환한다.
- `worker/result`는 같은 owner scope에서 claim한 invocation의 결과만 받는다.

시스템 자동화가 필요한 경우에는 별도 owner를 둔다.

```text
ownerKind = "user" | "system"
ownerId = "user_123" | "system_default"
```

이 시스템 owner는 백오피스 자동 생성, admin prompt preview, scheduled job 같은 용도로 명시적으로 연결한 worker를 사용할 수 있다. 하지만 사용자-facing AI 기능의 기본값은 항상 사용자의 own Codex worker다.

## 3. 비목표

- OpenAI API와 wire-compatible한 `/v1/*` 프록시를 만들지 않는다.
- 단순 chat completion, embedding, image generation 같은 범용 모델 API를 재현하지 않는다.
- 초기 버전에서 범용 AI agent 플랫폼을 만들지 않는다.
- Claude Code, OpenCode, Cursor 등 다른 로컬 에이전트는 MVP 범위에서 제외한다.
- Vercel Function을 장시간 실행 worker로 사용하지 않는다.
- 서버가 사용자의 로컬 머신으로 직접 inbound 접속하지 않는다.

## 4. 전체 구조

```text
Vercel Web App
  - login
  - app UI
  - invoke demo
  - worker status
  - result preview

Host Web Server + CodexDock SDK
  - invoke API for apps
  - pairing
  - worker auth
  - worker connection
  - request forwarding
  - result persistence
  - host app DB integration

Local CodexDock CLI
  - connect/login
  - local worker daemon
  - queue polling or notification subscription
  - request handling
  - Codex adapter
  - result return

Local Codex
  - Codex SDK/CLI를 통해 작업 수행
```

## 5. 패키지 구조

초기에는 하나의 repo 안에서 monorepo로 시작한다.

```text
codexdock/
  apps/
    web/                 # Vercel 배포용 Next.js 앱
  packages/
    cli/                 # codexdock CLI
    sdk/                 # 웹서버에 설치하는 CodexDock SDK
    protocol/            # shared schema/types
    codex-adapter/       # Codex SDK 연결 계층
  docs/
    codexdock-planning-and-development.md
```

예상 npm 패키지:

```text
codexdock
@codexdock/cli
@codexdock/sdk
@codexdock/protocol
@codexdock/codex-adapter
```

## 6. 핵심 플로우

### 6.1 Worker 연결

```text
1. 사용자가 웹에 로그인한다.
2. 웹에서 "Connect local Codex"를 누른다.
3. 서버가 one-time pairing code를 생성한다.
4. 웹 UI가 CLI 명령을 보여준다.

   npx codexdock connect https://example.vercel.app --code ABCD-EFGH

5. CLI가 서버의 discovery endpoint를 확인한다.
6. CLI가 device name, public key, capabilities를 보낸다.
7. 사용자가 웹에서 연결을 승인한다.
8. CLI가 worker token을 받는다.
9. CLI는 token을 OS keychain 또는 로컬 secure store에 저장한다.
10. 이후 codexdock start로 worker daemon을 실행한다.
```

### 6.2 요청 실행

```text
1. 앱 또는 웹 UI가 OpenAI API 호출 대신 CodexDock SDK의 invoke API를 호출한다.
2. CodexDock SDK는 host app DB에 invocation을 pending 상태로 저장한다.
3. 해당 owner에 연결된 로컬 worker가 queue 또는 notification을 통해 다음 pending invocation을 가져간다.
4. worker는 Codex adapter로 작업을 시작한다.
5. worker는 실행 로그, 상태 이벤트, 결과를 SDK endpoint로 반환한다.
6. SDK는 host app DB에 결과를 저장한다.
7. 앱은 invocation id로 상태와 결과를 조회한다.
```

## 7. API 초안

CodexDock SDK가 제공하는 API는 OpenAI API compatible endpoint가 아니라 invoke-oriented API다. 앱은 prompt와 generation parameters를 포함한 요청을 만들고, SDK는 host app DB에 invocation을 저장한 뒤 로컬 worker가 가져가 실행할 수 있게 한다.

```text
GET  /.well-known/codexdock.json

POST /api/codexdock/pairing/start
POST /api/codexdock/pairing/claim
POST /api/codexdock/pairing/approve

POST /api/codexdock/invoke
GET  /api/codexdock/invocations/:invocationId

GET  /api/codexdock/worker/status
POST /api/codexdock/worker/connect
POST /api/codexdock/worker/next
POST /api/codexdock/worker/result
```

앱에서 OpenAI API 대신 호출하는 기본 형태:

```http
POST /api/codexdock/invoke
```

```json
{
  "type": "generate_file",
  "prompt": "Create a concise README draft for this project.",
  "parameters": {
    "targetPath": "README.md",
    "format": "markdown",
    "usage": "repo-doc"
  }
}
```

응답은 즉시 결과가 아니라 invocation handle을 반환한다.

```json
{
  "invocationId": "inv_123",
  "status": "pending",
  "statusUrl": "/api/codexdock/invocations/inv_123"
}
```

앱은 `GET /api/codexdock/invocations/:invocationId`로 상태와 결과를 조회한다.

```json
{
  "invocationId": "inv_123",
  "status": "completed",
  "type": "generate_file",
  "result": {
    "kind": "file",
    "summary": "README draft generated.",
    "filename": "README.md",
    "mediaType": "text/markdown",
    "encoding": "utf-8",
    "content": "# Project\n\n..."
  }
}
```

Discovery response 예시:

```json
{
  "name": "CodexDock",
  "protocolVersion": "0.1.0",
  "endpoints": {
    "pairingClaim": "/api/codexdock/pairing/claim",
    "workerConnect": "/api/codexdock/worker/connect",
    "invoke": "/api/codexdock/invoke"
  }
}
```

## 8. 상태 관리 초안

CodexDock SDK가 자체 DB를 제공하지는 않는다. SDK가 설치된 host web app의 DB를 사용해 invocation 상태를 저장한다. 예제 앱은 간단한 DB schema로 pending/running/completed/failed 상태만 관리한다.

```text
codexdock_workers
  workerId
  deviceName
  capabilities
  tokenHash
  status
  lastSeenAt
  createdAt

codexdock_invocations
  requestId
  workerId
  type
  prompt
  payload
  status
  result
  error
  createdAt
  claimedAt
  completedAt
```

이 구조는 host app이 이미 가진 DB에 얇게 얹는 비동기 invocation queue다. CodexDock SDK는 schema/helper/route handler를 제공하고, 실제 persistence는 host app이 선택한 DB(Postgres, SQLite, Supabase 등)를 사용한다.

예제 앱은 외부 DB나 별도 서비스를 요구하지 않는 방향으로 만든다. Node.js 프로세스 메모리에 invocation queue를 두고, 개발용 fake worker가 `worker/next`와 `worker/result` endpoint로 전체 흐름을 검증하는 바로 실행 가능한 샘플이면 충분하다. 실제 사용 경로의 기본 worker는 Codex SDK adapter다. 이 예제는 프로세스가 재시작되면 invocation 상태가 사라져도 된다.

운영 환경에서는 worker가 웹서버의 요청을 오래 물고 있는 long-poll 방식을 기본으로 하지 않는다. `POST /api/codexdock/invoke`는 invocation을 저장하고 즉시 반환하며, worker는 다음 방식 중 하나로 pending invocation을 가져간다.

- Queue polling: worker가 짧은 요청으로 `next`를 확인하고 즉시 반환받는다. idle 상태에서는 backoff와 jitter를 적용한다.
- Notification + fetch: host app이 invocation 생성 시 realtime/provider notification을 보내고, worker는 알림을 받은 뒤 `next`를 호출해 실제 parameters를 가져간다.
- Dedicated queue adapter: Redis/SQS/Upstash/Supabase/Cloudflare 등 host app이 선택한 queue를 SDK adapter로 연결한다.

핵심 원칙은 CodexDock worker가 운영 웹서비스의 함수 invocation을 장시간 점유하지 않는 것이다.

## 9. CLI 명령 초안

```bash
codexdock connect <server-url> --code <pairing-code>
codexdock start [--adapter sdk|fake]
codexdock start --adapter sdk --codex-workdir <project-path> [--skip-git-repo-check]
codexdock status
codexdock logout
codexdock doctor
```

MVP에서 가장 중요한 명령:

```bash
npx codexdock connect https://example.vercel.app --code ABCD-EFGH
codexdock start --adapter sdk --codex-workdir /path/to/project
codexdock status
```

Codex SDK adapter는 Codex가 실행될 작업 디렉토리가 필요하다. 일반적으로 Git repo 경로를 넘긴다. Git repo가 아닌 개발용 폴더에서만 `--skip-git-repo-check`를 함께 사용한다.

## 10. Codex 연결 전략

CodexDock CLI는 Codex 연결을 별도 adapter로 격리한다.

CodexDock SDK는 OpenAI API key를 사용해 모델을 호출하지 않는다. Codex 실행 권한과 인증은 사용자의 로컬 Codex 환경에 있다. 초기 버전은 로컬 Codex 로그인 상태를 우선 사용한다.

초기 adapter 책임:

- Codex 실행 가능 여부 확인
- 현재 Codex 로그인 상태 확인
- invoke prompt를 Codex thread/session으로 전달
- Codex 결과를 SDK 응답 payload로 변환
- 생성 데이터, 파일 내용, 로그를 결과 후보로 수집
- 실패 원인을 사용자에게 읽히는 error code로 변환

adapter interface 초안:

```ts
export interface CodexAdapter {
  doctor(): Promise<CodexDoctorResult>;
  invoke(input: CodexInvokeInput, events: CodexEventSink): Promise<CodexInvokeResult>;
}
```

Codex 연결 구현은 SDK 기반을 우선한다. app-server 통합은 MVP 범위에서 제외한다.

## 11. 결과 저장 전략

초기 MVP는 별도 file storage 없이 host app DB에 JSON 결과를 저장한다. 파일과 이미지는 같은 result endpoint로 전달하되, 결과 JSON 안에 artifact envelope을 넣는다.

```text
1. 앱이 CodexDock SDK invoke API 호출
2. SDK가 host app DB에 invocation 저장
3. worker가 next endpoint로 invocation claim
4. worker가 Codex SDK로 결과 생성
5. worker가 SDK result endpoint로 결과 제출
6. SDK가 host app DB에 result JSON을 저장
7. 앱이 status endpoint로 JSON 결과 조회
```

파일 artifact 결과:

```json
{
  "kind": "file",
  "summary": "Generated README.md.",
  "filename": "README.md",
  "mediaType": "text/markdown",
  "encoding": "utf-8",
  "content": "# Project\n\n..."
}
```

이미지 artifact 결과:

```json
{
  "kind": "image",
  "summary": "Generated image artifact.",
  "filename": "scene-thumbnail.png",
  "mediaType": "image/png",
  "encoding": "base64",
  "base64": "...",
  "dataUri": "data:image/png;base64,...",
  "promptUsed": "..."
}
```

운영 단계에서 큰 파일과 이미지는 DB에 base64를 계속 저장하지 않는다. host app이 storage 정책을 가지므로 CodexDock SDK에는 `artifactStore` 또는 `POST /api/codexdock/worker/artifacts` 같은 업로드 경로를 추가한다. worker는 worker token으로 outbound upload를 수행하고, 최종 result에는 `{ kind, filename, mediaType, artifactId, url, storagePath }` 같은 reference만 저장한다. Saygo 연동에서는 이 reference를 Saygo Zod schema로 다시 검증하고, Saygo storage 업로드와 `ai_call_ledger` 기록을 wrapper가 책임진다.

SDK는 `worker/result` 저장 전에 invocation type에 맞는 artifact schema를 다시 검증한다. `generate_file`은 file artifact, `generate_image`는 image artifact가 아니면 completed로 저장하지 않는다.

## 12. 보안 원칙

- worker token은 사용자의 특정 worker에만 연결한다.
- worker token은 기본적으로 필수다. local smoke test처럼 명시적으로 허용한 경우에만 insecure worker auth를 쓸 수 있다.
- worker token은 서버에 hash로 저장한다.
- pairing code는 짧은 만료 시간을 가진다.
- 고정된 `/api/codexdock/*` path는 숨김 보안으로 취급하지 않는다. worker endpoint는 bearer token으로 보호하고, invoke endpoint는 host app의 사용자/관리자 인증, quota, rate limit으로 보호한다.
- invocation은 timeout을 가진다.
- 연결된 worker가 없어도 invoke 요청은 pending invocation으로 저장할 수 있다. UI는 worker offline 상태를 별도로 표시한다.
- 서버가 임의 shell command를 직접 worker에 보내지 않는다.
- invoke type과 parameters schema를 allowlist로 관리한다.
- 로컬 파일 접근은 worker 설정과 Codex sandbox 정책을 따른다.

## 13. MVP 마일스톤

### Phase 0: 문서 및 프로토콜 고정

- 제품명, repo 구조, 패키지명 확정
- invoke request/response schema 초안 작성
- pairing flow 확정
- Codex 연결 방식 조사

### Phase 1: SDK 기본 기능

- 외부 DB 없는 메모리 기반 예제 설계
- Next.js route handler helper 작성
- `POST /api/codexdock/invoke` 작성
- worker connect/result endpoint 작성
- host app DB용 invocation schema 작성
- invocation status 조회 endpoint 작성
- invocation timeout 처리 작성

### Phase 2: CLI 기본 기능

- `codexdock connect` 구현
- token secure storage 구현
- `codexdock start` local worker 구현
- SDK endpoint queue polling 구현
- idle backoff와 jitter 구현
- 개발용 fake runner로 invoke 요청/응답 완료까지 검증

### Phase 3: Codex SDK 연결

- codex adapter 구현
- `codexdock doctor` 구현
- 실제 Codex invoke 실행
- JSON 결과 반환
- timeout/실패 처리

### Phase 4: 데이터/이미지 생성 확장

- structured JSON schema 결과
- `generate_image` 결과 schema
- 작은 파일/이미지 inline artifact 결과
- 큰 파일/이미지용 storage adapter 또는 worker artifact upload endpoint

### Phase 5: 제품화

- worker offline 처리
- 다중 worker 선택
- 로그/진행 상태 개선
- install guide 작성
- npm publish 준비

## 14. 초기 성공 기준

첫 번째 성공 시나리오:

```text
1. 사용자가 Vercel 사이트에 로그인한다.
2. 사이트에서 CodexDock 연결 명령을 복사한다.
3. 로컬에서 `npx codexdock connect ...`를 실행한다.
4. 로컬에서 `codexdock start`를 실행한다.
5. 앱 또는 웹 UI가 OpenAI API 호출 대신 `POST /api/codexdock/invoke`로 "README 초안 생성" 요청을 보낸다.
6. CodexDock SDK가 host app DB에 invocation을 저장한다.
7. 로컬 CodexDock worker가 invocation을 가져간다.
8. 로컬 Codex가 요청을 실행한다.
9. worker가 생성된 README 내용을 SDK로 제출한다.
10. 앱 또는 사용자가 API/UI에서 결과물을 확인한다.
```

이 시나리오가 통과하면 CodexDock MVP의 핵심 가치는 증명된다.
