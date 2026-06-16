# CodexDock 개발 스펙 및 TODO

## 1. 목적

CodexDock은 웹서비스가 OpenAI API를 직접 호출하지 않고, AI로 처리할 작업을 사용자의 로컬 Codex 실행 환경에 위임할 수 있게 해주는 SDK + CLI worker다.

핵심 목적은 다음과 같다.

- 웹서비스는 `@codexdock/sdk`를 설치해 AI 작업 요청을 생성한다.
- 로컬 사용자는 `codexdock` CLI를 실행해 웹서비스와 자신의 로컬 Codex를 연결한다.
- 웹서비스는 OpenAI API key를 보관하지 않는다.
- 로컬 머신은 외부에서 inbound 접속을 받지 않는다.
- 로컬 CLI worker가 outbound 요청으로 작업을 가져가고, Codex SDK로 실행한 뒤 결과를 다시 웹서비스에 제출한다.

CodexDock은 OpenAI API compatible proxy가 아니다. `/v1/chat/completions` 형태를 재현하지 않고, `invoke -> invocation -> worker claim -> result` 흐름을 제공한다.

## 2. 제품 경험 기준

QA와 개발은 아래 경험을 기준으로 판단한다.

### 앱 개발자 경험

앱 개발자는 기존 웹서비스에 CodexDock SDK를 설치하고, OpenAI API 호출을 다음 흐름으로 바꿀 수 있어야 한다.

```ts
const invocation = await codexdock.invoke({
  type: "generate_data",
  prompt: "Create product card data for this page.",
  payload: {
    count: 8,
    format: "json"
  }
});
```

기대 경험:

- API key 없이 AI 작업 요청을 만들 수 있다.
- 요청 직후 `invocationId`를 받고, UI는 pending 상태를 보여줄 수 있다.
- 로컬 worker가 켜져 있으면 결과가 completed 상태로 바뀐다.
- 결과는 JSON으로 조회 가능하다.
- worker가 없으면 pending 상태와 복구 안내를 받고, 실행 실패 시에는 명확한 error code를 받는다.

### 로컬 worker 사용자 경험

로컬 사용자는 웹 UI에서 연결 명령을 복사하고, 터미널에서 CLI를 실행한다.

```bash
npx codexdock connect https://example.vercel.app --code ABCD-EFGH
codexdock start
```

기대 경험:

- 연결 과정에서 어떤 웹서비스와 연결되는지 명확히 보인다.
- worker token은 로컬 secure storage에 저장된다.
- `codexdock start`는 작업을 기다리다가 pending invocation을 가져간다.
- 작업 실행 중 현재 invocation id, type, 상태가 보인다.
- 결과 제출 성공/실패가 터미널에 명확히 표시된다.

### 최종 사용자 경험

최종 사용자는 웹서비스 안에서 AI 결과를 얻는다. 사용자는 CodexDock 내부 구조를 몰라도 된다.

예시 경험:

- 버튼을 누르면 "생성 중" 상태가 보인다.
- 로컬 Codex worker가 실행되면 결과 데이터가 화면에 반영된다.
- worker가 꺼져 있으면 "로컬 Codex worker가 연결되어 있지 않음" 같은 복구 가능한 메시지를 본다.

## 3. MVP 원칙

- Codex SDK를 primary execution path로 사용한다.
- Codex app-server 통합은 MVP 범위에서 제외한다.
- OpenAI API compatible endpoint를 만들지 않는다.
- 로컬 머신 inbound 연결을 요구하지 않는다.
- 운영 웹서비스의 request를 오래 물고 있는 long-poll을 기본으로 하지 않는다.
- worker는 짧은 `next` 요청으로 pending invocation을 claim한다.
- idle 상태에서는 backoff와 jitter를 적용한다.
- 예제 앱은 외부 DB, Redis, Supabase, queue 없이 바로 실행 가능한 구조로 만든다.
- 실제 제품 통합은 host app이 가진 DB를 사용한다.

## 4. 시스템 구조

```text
Host Web App
  - app UI
  - app DB or example memory store
  - CodexDock SDK route handlers

CodexDock SDK
  - invoke API
  - invocation persistence adapter
  - worker auth
  - worker claim/result endpoints
  - status/result lookup

CodexDock CLI
  - connect
  - start worker
  - claim pending invocation
  - run Codex adapter
  - submit result

Codex Adapter
  - Codex SDK wrapper
  - fake adapter for tests/examples
  - result normalization
```

## 5. 패키지 스펙

초기 repo는 monorepo로 구성한다.

```text
codexdock/
  apps/
    example-web/
  packages/
    sdk/
    cli/
    protocol/
    codex-adapter/
  docs/
```

### `packages/protocol`

역할:

- SDK, CLI, adapter가 공유하는 타입과 schema를 제공한다.
- runtime validation은 `zod`를 기본으로 한다.
- protocol version을 포함한다.

주요 타입:

```ts
type InvocationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";

interface InvokeRequest {
  type: string;
  prompt: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}

interface InvocationRecord {
  invocationId: string;
  workerId?: string;
  type: string;
  prompt: string;
  payload: Record<string, unknown>;
  status: InvocationStatus;
  result?: unknown;
  error?: CodexDockError;
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
  expiresAt?: string;
}

interface WorkerNextResponse {
  invocationId: string;
  type: string;
  prompt: string;
  payload: Record<string, unknown>;
}

interface WorkerResultRequest {
  invocationId: string;
  ok: boolean;
  result?: unknown;
  error?: CodexDockError;
}

interface WorkerRecord {
  workerId: string;
  deviceName: string;
  capabilities: string[];
  status: "online" | "offline" | "revoked";
  lastSeenAt: string;
  createdAt: string;
  revokedAt?: string;
}

interface CodexDockError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

`pending`은 아직 worker가 claim하지 않은 상태를 뜻한다. 연결된 worker가 없어도 `invoke` 요청은 기본적으로 pending invocation을 생성한다. UI는 worker presence를 별도로 확인해 "worker가 연결되어 있지 않음"을 안내한다.

초기 invoke type:

- `generate_data`: UI나 이미지 생성을 위한 structured JSON을 만든다.
- `generate_file`: 파일 내용 또는 파일 초안을 만든다.
- `generate_image_plan`: 이미지 생성에 필요한 prompt, layout, palette, asset metadata를 만든다.

초기 error code:

- `WORKER_OFFLINE`: 처리 가능한 worker가 아직 없거나 worker가 offline이다.
- `UNSUPPORTED_INVOKE_TYPE`: 허용되지 않은 invoke type이다.
- `INVALID_PAYLOAD`: payload schema 검증에 실패했다.
- `INVOCATION_TIMEOUT`: invocation이 제한 시간 안에 완료되지 않았다.
- `WORKER_AUTH_INVALID`: worker token이 없거나 유효하지 않다.
- `WORKER_REVOKED`: worker가 revoke된 상태다.
- `CODEX_NOT_AVAILABLE`: 로컬 Codex 실행 환경을 사용할 수 없다.
- `CODEX_AUTH_REQUIRED`: 로컬 Codex 인증이 필요하다.
- `CODEX_RUN_FAILED`: Codex 실행 중 실패했다.

### `packages/sdk`

역할:

- host web app에 설치되는 서버-side SDK다.
- Next.js route handler helper를 우선 지원한다.
- persistence adapter를 통해 host app DB 또는 예제 memory store를 사용한다.
- worker auth, invocation create/claim/result/status를 처리한다.

초기 public API:

```ts
createCodexDock({
  persistence,
  auth,
  allowedInvokeTypes,
  workerTokenSecret,
  timeouts
});

codexdock.invoke(input);
codexdock.getInvocation(invocationId);
codexdock.getWorkerStatus();
codexdock.workerConnect(input);
codexdock.workerNext(workerId);
codexdock.workerResult(input);
```

Next.js route helper 예시:

```ts
export const POST = codexdock.handlers.invoke;
```

Persistence adapter:

```ts
interface CodexDockPersistence {
  createInvocation(input): Promise<InvocationRecord>;
  getInvocation(invocationId: string): Promise<InvocationRecord | null>;
  claimNextInvocation(workerId: string): Promise<InvocationRecord | null>;
  completeInvocation(input): Promise<InvocationRecord>;
  failInvocation(input): Promise<InvocationRecord>;
  upsertWorker(input): Promise<WorkerRecord>;
  getWorker(workerId: string): Promise<WorkerRecord | null>;
}
```

### `packages/cli`

역할:

- 사용자의 로컬 머신에서 실행된다.
- 웹서비스에 outbound 요청만 보낸다.
- worker token을 저장하고 사용한다.
- pending invocation을 claim하고 Codex adapter로 실행한다.

명령:

```bash
codexdock connect <server-url> --code <pairing-code>
codexdock start [--adapter fake|sdk]
codexdock start --adapter sdk --codex-workdir <project-path> [--skip-git-repo-check]
codexdock status
codexdock logout
codexdock doctor
```

실제 Codex SDK adapter를 사용할 때는 Codex가 실행될 작업 디렉토리를 명시한다. Codex CLI는 기본적으로 Git repo 안에서 실행되기를 요구하므로, 개발용 예제처럼 Git repo가 아닌 폴더에서 테스트할 때만 `--skip-git-repo-check`를 사용한다.

동일한 값은 환경변수로도 설정할 수 있다.

```bash
CODEXDOCK_ADAPTER=sdk
CODEXDOCK_CODEX_WORKDIR=/path/to/project
CODEXDOCK_CODEX_SKIP_GIT_REPO_CHECK=true
```

`codexdock start` 동작:

```text
1. saved worker token 로드
2. worker/connect 호출
3. loop 시작
4. worker/next 호출
5. 204면 backoff 후 재시도
6. 200이면 invocation 실행
7. worker/result 제출
8. 다음 invocation 처리
```

Polling 정책:

- long-poll 금지.
- `worker/next`는 즉시 `200` 또는 `204`를 반환한다.
- idle delay는 2초에서 시작해 최대 30초까지 증가한다.
- jitter를 적용해 worker들이 동시에 몰리지 않게 한다.
- 작업을 처리하면 delay를 초기화한다.

### `packages/codex-adapter`

역할:

- Codex SDK 실행을 감싼다.
- fake adapter와 real SDK adapter를 모두 제공한다.
- SDK 결과를 CodexDock result payload로 정규화한다.

초기 interface:

```ts
interface CodexInvokeInput {
  invocationId: string;
  type: string;
  prompt: string;
  payload: Record<string, unknown>;
}

interface CodexInvokeResult {
  result: unknown;
  logs?: CodexEvent[];
}

interface CodexEvent {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  payload?: Record<string, unknown>;
}

interface CodexEventSink {
  emit(event: CodexEvent): Promise<void>;
}

interface CodexDoctorResult {
  ok: boolean;
  codexAvailable: boolean;
  authenticated: boolean;
  message?: string;
  error?: CodexDockError;
}

interface CodexAdapter {
  doctor(): Promise<CodexDoctorResult>;
  invoke(input: CodexInvokeInput, events: CodexEventSink): Promise<CodexInvokeResult>;
}
```

MVP adapter:

- `FakeCodexAdapter`: 예제와 SDK/CLI e2e 테스트용
- `SdkCodexAdapter`: 실제 Codex SDK 실행용

## 6. API 스펙

### 앱용 API

```http
POST /api/codexdock/invoke
```

요청:

```json
{
  "type": "generate_data",
  "prompt": "Create product card data.",
  "payload": {
    "count": 8
  },
  "idempotencyKey": "optional-client-key"
}
```

응답:

```json
{
  "invocationId": "inv_123",
  "status": "pending",
  "statusUrl": "/api/codexdock/invocations/inv_123"
}
```

```http
GET /api/codexdock/invocations/:invocationId
```

응답:

```json
{
  "invocationId": "inv_123",
  "status": "completed",
  "type": "generate_data",
  "result": {
    "items": []
  }
}
```

### Worker API

```http
POST /api/codexdock/worker/connect
```

목적:

- worker online 상태 갱신
- capabilities 등록
- polling policy 수신

```http
POST /api/codexdock/worker/next
```

목적:

- worker가 처리 가능한 pending invocation 하나를 atomic claim한다.
- 작업이 없으면 즉시 `204 No Content`를 반환한다.
- 이미 다른 worker가 claim한 invocation은 다시 반환하지 않는다.

```http
POST /api/codexdock/worker/result
```

목적:

- worker가 completed 또는 failed 결과를 제출한다.
- SDK는 host app persistence에 결과를 저장한다.
- result 제출자는 해당 invocation을 claim한 worker여야 한다.

```http
GET /api/codexdock/worker/status
```

목적:

- 연결된 worker가 있는지 확인한다.
- UI가 pending invocation과 worker offline 상태를 구분해서 보여줄 수 있게 한다.

## 7. 상태 저장 스펙

CodexDock SDK는 자체 DB를 강제하지 않는다. host app이 가진 DB에 얇은 table/schema를 추가하거나, 예제 앱에서는 memory store를 사용한다.

운영용 최소 schema:

```text
codexdock_workers
  workerId
  userId/projectId
  deviceName
  capabilities
  tokenHash
  status
  lastSeenAt
  createdAt
  revokedAt

codexdock_invocations
  invocationId
  ownerId/projectId
  workerId
  type
  prompt
  payload
  status
  result
  error
  attempts
  idempotencyKey
  createdAt
  claimedAt
  completedAt
  expiresAt
```

예제용 memory store:

- 외부 DB/service를 요구하지 않는다.
- Node.js 프로세스 메모리로 충분하다.
- 재시작 시 상태가 사라져도 된다.
- QA는 "바로 실행 가능"을 우선 검증한다.

## 8. 보안 스펙

Pairing:

- pairing code는 짧은 TTL을 가진다.
- CLI는 pairing code로 claim만 할 수 있다.
- 웹 UI에서 사용자가 approve해야 worker token을 발급한다.

Worker auth:

- worker token은 특정 host app/project/worker에 묶인다.
- 서버에는 token 원문을 저장하지 않고 hash만 저장한다.
- token revoke가 가능해야 한다.
- worker는 자신이 claim한 invocation에 대해서만 result를 제출할 수 있다.
- invocation claim은 atomic해야 하며, 같은 invocation이 두 worker에게 동시에 배정되면 안 된다.

Invoke safety:

- `type`은 allowlist로 제한한다.
- payload는 type별 schema로 검증한다.
- prompt/payload size limit을 둔다.
- invocation timeout을 둔다.
- worker가 arbitrary shell command를 직접 받는 구조를 만들지 않는다.
- 로컬 파일 접근은 Codex sandbox와 worker 설정을 따른다.

Network:

- 로컬 worker는 outbound 요청만 사용한다.
- host app은 로컬 머신으로 직접 접속하지 않는다.
- long-poll로 웹서버 request를 장시간 점유하지 않는다.

## 9. 예제 앱 스펙

예제 앱은 최대한 바로 실행 가능해야 한다.

제약:

- 외부 DB 없음
- Supabase 없음
- Redis 없음
- queue provider 없음
- Codex SDK 연결 전에는 fake adapter 사용

구성:

```text
apps/example-web
  - invoke form
  - invocation list
  - worker status
  - result preview

packages/cli
  - fake worker 실행 가능
```

예제 성공 흐름:

```text
1. example web 실행
2. worker 실행
3. UI에서 generate_data 요청 생성
4. memory store에 pending invocation 생성
5. worker가 next로 claim
6. fake adapter가 JSON result 생성
7. worker가 result 제출
8. UI가 completed result 표시
```

## 10. TODO

### Phase 0: 프로토콜 고정

- [x] `docs/codexdock-development-spec-and-todo.md`를 기준 문서로 확정
- [x] invoke status enum 확정
- [x] error code 목록 초안 작성
- [x] invoke type allowlist 초안 작성
- [ ] pairing state machine 작성
- [x] worker polling/backoff 정책 확정

### Phase 1: Repo/패키지 세팅

- [x] pnpm workspace 생성
- [x] TypeScript 설정
- [x] build/check/smoke 명령 추가
- [x] `packages/protocol` 생성
- [x] `packages/sdk` 생성
- [x] `packages/cli` 생성
- [x] `packages/codex-adapter` 생성
- [x] `apps/example-web` 생성

### Phase 2: Protocol 구현

- [x] zod schema 작성
- [x] request/response 타입 export
- [x] error code 타입 작성
- [x] protocol version 상수 추가
- [ ] schema unit test 작성

### Phase 3: SDK 구현

- [x] memory persistence adapter 작성
- [x] invocation create API 작성
- [x] invocation status API 작성
- [x] worker connect API 작성
- [x] worker status API 작성
- [x] worker next claim API 작성
- [x] worker result API 작성
- [x] route handler helper 작성
- [x] timeout/expiry 저장 필드 처리 작성
- [x] idempotencyKey 처리 작성

### Phase 4: CLI 구현

- [x] `codexdock connect` scaffold
- [x] dev token mode 추가
- [x] worker token file storage 구현
- [x] `codexdock start` loop 작성
- [x] `worker/next` short polling 구현
- [x] idle backoff/jitter 구현
- [x] result submit 구현
- [x] `codexdock status` 작성
- [x] `codexdock doctor` 작성

### Phase 5: Fake Adapter E2E

- [x] fake adapter 작성
- [x] example web invoke UI 작성
- [x] worker status UI 작성
- [x] invocation list/result preview 작성
- [x] local e2e smoke script 작성
- [x] worker offline waiting case 검증 기준 작성
- [x] worker failure case 구현 경로 작성
- [x] duplicate claim 방지 구현

### Phase 6: Codex SDK Adapter

- [x] Codex SDK 설치/호출 방식 확인
- [x] `SdkCodexAdapter.doctor()` 구현
- [x] `SdkCodexAdapter.invoke()` 구현
- [x] final response -> result payload 변환
- [x] CLI에서 Codex working directory와 git repo check 옵션 연결
- [x] 실제 Codex live run QA
- [ ] structured JSON result 강제 schema 처리
- [ ] timeout/abort 처리
- [ ] local Codex auth failure 세분화 처리

### Phase 7: Productization

- [ ] real pairing flow 구현
- [ ] worker token hash/revoke 구현
- [ ] host app DB adapter 예시 작성
- [ ] install guide 작성
- [ ] API reference 작성
- [ ] package publish 준비

## 11. QA 기준

QA는 "OpenAI API 없이, 웹앱이 로컬 Codex worker를 통해 AI 결과를 얻는 경험"을 기준으로 검증한다.

### QA 목적 설명

CodexDock의 목적은 웹서비스가 AI 작업을 로컬 Codex runtime으로 위임하는 것이다. 사용자는 웹서비스에서 생성 요청을 만들고, 로컬에서 실행 중인 CodexDock CLI가 그 요청을 가져가 Codex로 처리한 뒤 결과를 웹서비스에 돌려줘야 한다.

QA가 확인해야 하는 핵심 경험:

- 앱은 OpenAI API key 없이 invocation을 생성한다.
- 로컬 worker는 inbound 접속 없이 outbound 요청만으로 작업을 가져간다.
- worker가 켜져 있으면 pending invocation이 completed로 바뀐다.
- worker가 꺼져 있으면 앱은 복구 가능한 상태를 보여준다.
- 결과는 앱 UI/API에서 확인 가능하다.
- 웹서비스 request가 long-poll로 오래 물리지 않는다.

### QA 시나리오

#### QA-01: 예제 앱 바로 실행

목적:

- 외부 서비스 없이 예제 앱이 실행되는지 확인한다.

통과 기준:

- 새 checkout에서 install 후 example web이 실행된다.
- 별도 DB/Redis/Supabase 설정이 필요 없다.
- UI에서 invoke form, worker status, invocation list가 보인다.

#### QA-02: Worker 없는 상태

목적:

- worker가 없을 때 앱이 대기 상태와 복구 안내를 명확히 보여주는지 확인한다.

통과 기준:

- invoke 생성은 가능하다.
- status는 pending으로 유지되고, UI는 worker offline 안내를 별도로 표시한다.
- 사용자는 worker 실행이 필요하다는 메시지를 볼 수 있다.

#### QA-03: Fake worker 완료 흐름

목적:

- SDK와 CLI의 end-to-end protocol을 검증한다.

통과 기준:

- worker 실행 후 pending invocation을 claim한다.
- invocation status가 running을 거쳐 completed가 된다.
- result payload가 UI/API에 표시된다.
- worker terminal에 claimed/completed 로그가 보인다.

#### QA-04: Worker failure 흐름

목적:

- 로컬 실행 실패가 앱에 전달되는지 확인한다.

통과 기준:

- fake worker가 실패를 제출할 수 있다.
- invocation status가 failed가 된다.
- error code/message가 UI/API에 표시된다.
- 실패 후 worker loop는 계속 살아 있다.

#### QA-05: No long-poll 검증

목적:

- worker가 운영 웹서비스 request를 오래 점유하지 않는지 확인한다.

통과 기준:

- `worker/next`는 작업이 없을 때 즉시 `204`를 반환한다.
- CLI는 idle backoff와 jitter를 적용한다.
- 동시에 여러 worker를 실행해도 hanging request가 누적되지 않는다.

#### QA-06: 보안 기본 검증

목적:

- 인증 없는 worker 요청이 차단되는지 확인한다.

통과 기준:

- token 없이 `worker/next` 호출 시 401/403이 반환된다.
- 잘못된 token으로 `worker/result` 제출이 거부된다.
- unsupported invoke type은 400으로 거부된다.
- oversized payload는 거부된다.
- claim하지 않은 worker가 `worker/result`를 제출하면 거부된다.

#### QA-07: Atomic claim 검증

목적:

- 여러 worker가 동시에 대기할 때 같은 invocation이 중복 실행되지 않는지 확인한다.

통과 기준:

- 동일 invocation은 하나의 worker에게만 running 상태로 claim된다.
- 동시에 여러 worker가 `worker/next`를 호출해도 completed result는 한 번만 저장된다.
- 중복 result 제출은 거부되거나 idempotent하게 처리된다.

#### QA-08: Codex SDK adapter 검증

목적:

- fake adapter가 아닌 실제 로컬 Codex 실행을 검증한다.

통과 기준:

- `codexdock doctor`가 로컬 Codex 사용 가능 여부를 보여준다.
- Codex auth가 없으면 명확한 오류를 보여준다.
- 실제 invoke가 Codex SDK를 통해 실행된다.
- 결과가 completed invocation에 저장된다.

#### QA-09: 데이터/이미지 준비 결과

목적:

- API 대신 로컬 Codex로 데이터와 이미지 준비 데이터를 만들 수 있는지 확인한다.

통과 기준:

- `generate_data`가 structured JSON을 반환한다.
- `generate_image_plan`이 image prompt/data/layout 정보를 반환한다.
- 앱은 반환된 데이터를 화면에 렌더링할 수 있다.

## 12. 출시 전 체크리스트

- [ ] README quickstart 작성
- [ ] example app 실행 영상 또는 스크린샷 확보
- [ ] SDK API reference 작성
- [ ] CLI command reference 작성
- [ ] 보안 모델 문서화
- [ ] known limitations 문서화
- [ ] npm package name 최종 확인
- [ ] package publish dry run
- [ ] fresh machine install 테스트
