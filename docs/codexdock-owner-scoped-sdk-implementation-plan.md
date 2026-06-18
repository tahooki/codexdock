# CodexDock Owner-Scoped SDK Implementation Plan

Created: 2026-06-17

## 1. Purpose

This document is the implementation plan for the next CodexDock architecture.

It combines:

- user-scoped local Codex workers
- framework-neutral host SDK design
- host-declared connection points
- OpenAI-inspired generation APIs
- schema-validated text/object/file/image results
- owner-scoped pairing, tokens, worker routing, and result submission
- artifact upload for generated files and images

Related source documents:

- [OpenAI API inspired generation plan](./openai-api-inspired-generation-plan.md)
- [CodexDock planning and development](./codexdock-planning-and-development.md)
- [CodexDock development spec and TODO](./codexdock-development-spec-and-todo.md)

## 1.1 Current Repo Status

The current repo is an early proof of concept. It already has:

- fixed example routes under `/api/codexdock/*`
- in-memory persistence
- a single development worker token model
- `generate_object`, `generate_file`, and `generate_image` invocation types
- inline file/image result envelopes for smoke tests
- a Codex SDK adapter and an internal smoke-test worker

This document describes the next architecture. Work should migrate the current implementation toward this plan without pretending all planned APIs already exist.

README and package docs must clearly separate:

- what works in the current MVP
- what is planned in this document
- which examples are local smoke examples versus production contracts

## 2. Core Product Decision

CodexDock is not primarily "one service connects one Codex account."

The primary model is:

```text
signed-in user
  -> user's owner-scoped invocation
  -> user's connected local CodexDock worker
  -> user's local Codex runtime
  -> result saved back to that same owner scope
```

System-owned workers are allowed, but only as explicit system owners:

```ts
type CodexDockOwner =
  | { ownerKind: "user"; ownerId: string }
  | { ownerKind: "system"; ownerId: string };
```

User-facing AI features must default to the current user's owner scope. A browser request must not be trusted to choose another `ownerId`; the host app must derive the owner from server-side auth/session or from a trusted system job.

## 3. Target Architecture

```text
Host App
  - auth/session
  - app routes chosen by host
  - app database
  - optional storage
  - @codexdock/sdk

CodexDock SDK
  - owner resolver
  - invocation creation
  - pairing lifecycle
  - worker token verification
  - worker capability matching
  - owner-scoped claim
  - result validation
  - artifact upload contract
  - framework-neutral Fetch handlers

CodexDock CLI Worker
  - connect to host discovery manifest
  - pair as a specific owner
  - store owner-scoped worker token
  - poll declared endpoints
  - run Codex adapter
  - upload artifacts
  - submit validated result envelope

Local Codex Runtime
  - user's Codex login/session/config
  - optional project working directory
```

## 4. Non-Goals

- Do not expose a mandatory fixed `/api/codexdock/*` API path.
- Do not trust client-supplied `ownerId`.
- Do not let one user's worker claim another user's invocation.
- Do not make a shared service-wide Codex account the default for user-facing features.
- Do not store large image/file base64 payloads in production invocation rows.
- Do not promise OpenAI wire compatibility.

## 5. Host SDK Shape

The host app should be able to choose its own routes and framework.

### 5.1 CodexDock instance

```ts
const codexdock = createCodexDock({
  persistence,
  tokenStore,
  artifactStore,
  resolveOwner: async (request) => {
    const session = await getSession(request);
    return { ownerKind: "user", ownerId: session.user.id };
  },
  allowSystemOwner: async (context) => context.job?.trusted === true,
});
```

For system jobs:

```ts
await codexdock.generateText({
  owner: { ownerKind: "system", ownerId: "system_default" },
  input: "Draft admin prompt preview.",
  parameters: { usage: "admin_prompt_preview" },
});
```

For user-facing jobs, prefer deriving owner from server context:

```ts
await codexdock.generateObject({
  input: "Create scene card data.",
  schema,
  parameters: { usage: "scene_card_preview" },
  context: { request },
});
```

The SDK resolves the owner server-side.

Important API boundary:

- Public HTTP handlers must ignore or reject browser-supplied `ownerId`.
- Public HTTP handlers should call `resolveOwner(request)` and attach the owner internally.
- Direct server-side SDK calls may pass `owner` explicitly only from trusted code paths, such as background jobs or admin-only server functions.
- System owner calls must go through `allowSystemOwner` or an equivalent explicit trust check.

### 5.2 Generation APIs

Advanced API:

```ts
await codexdock.responses.create({
  input: "Write a short scene intro.",
  instructions: "Be concise.",
  responseFormat: { type: "text" },
  options: { maxOutputTokens: 500 },
  parameters: { usage: "scene_intro" },
  context: { request },
});
```

Convenience helpers:

```ts
await codexdock.generateText(input);
await codexdock.generateObject(input);
await codexdock.generateFile(input);
await codexdock.generateImage(input);
```

All helpers normalize into a single owner-scoped invocation record.

### 5.3 Route handlers

The SDK should expose framework-neutral Fetch handlers:

```ts
const handlers = codexdock.createHandlers();
```

Framework packages can wrap those handlers:

```ts
// Next.js
export const POST = handlers.invoke;

// Express/Hono/Fastify adapters can map their request/response shape to Fetch.
```

The host may mount them anywhere:

```text
/api/ai-bridge/invoke
/internal/cdx/worker/next
/custom/codexdock/result
```

Endpoint paths are not security. Auth, owner scope, worker token verification, and claim checks are security.

Handler groups:

- App-facing handlers: create invocations, read invocation status, read worker status for the current owner.
- Pairing handlers: create/claim/approve short-lived owner-scoped pairing sessions.
- Worker handlers: connect, poll next work, upload artifacts, submit results.
- Discovery handler: returns endpoint/capability metadata and may be public.

App-facing status reads must also be owner-scoped. Knowing an `invocationId` must not be enough to read another owner's prompt, parameters, result, artifact references, or error details.

## 6. Connection Point Declaration

CodexDock CLI should not assume fixed endpoint paths.

The host app should publish a discovery manifest. The manifest describes where endpoints live; it does not authenticate a user and does not include owner-specific secrets.

```json
{
  "appName": "Saygo",
  "endpoints": {
    "pairingStart": "https://app.example.com/api/ai-bridge/pairing/start",
    "pairingClaim": "https://app.example.com/api/ai-bridge/pairing/claim",
    "pairingApprove": "https://app.example.com/api/ai-bridge/pairing/approve",
    "workerConnect": "https://app.example.com/api/ai-bridge/worker/connect",
    "workerNext": "https://app.example.com/api/ai-bridge/worker/next",
    "workerResult": "https://app.example.com/api/ai-bridge/worker/result",
    "artifactUpload": "https://app.example.com/api/ai-bridge/worker/artifacts",
    "artifactPrepare": "https://app.example.com/api/ai-bridge/worker/artifacts/prepare"
  },
  "capabilities": {
    "generationTypes": ["generate_text", "generate_object", "generate_file", "generate_image"],
    "artifactUpload": ["multipart", "signed"]
  }
}
```

`codexdock connect <server-url> --code <pairing-code>` should:

1. fetch the manifest
2. show app identity to the user
3. claim the already-created pairing session
4. receive endpoint map and owner-scoped worker token
5. store config locally
6. use declared endpoints for all future polling/result calls

`pairingStart` is normally called by the host web app while the user is logged in. The CLI should not be able to create an owner scope by itself.

## 7. Pairing Model

Pairing is owner-scoped.

```text
1. User logs into host app.
2. User clicks "Connect local Codex".
3. Host creates a short-lived pairing session for that owner.
4. CLI claims the pairing session from the same manifest.
5. Web UI shows device/capabilities.
6. User approves.
7. Host issues worker token scoped to host app + owner + worker.
8. CLI stores token in local secure storage.
```

Pairing ownership rule:

- `pairingStart` is server-side/web-session authenticated and binds the pairing session to the current owner.
- `pairingClaim` proves possession of the short code but does not issue a worker token yet.
- `pairingApprove` must be performed by the same signed-in owner or a trusted admin/system path.
- The worker token is issued only after approval.
- Expired, revoked, or already-approved pairing sessions cannot be reused.

Pairing record:

```ts
type PairingSession = {
  pairingId: string;
  ownerKind: "user" | "system";
  ownerId: string;
  codeHash: string;
  status: "pending" | "claimed" | "approved" | "expired" | "revoked";
  claimedWorkerId?: string;
  claimedDeviceName?: string;
  claimedCapabilities?: string[];
  expiresAt: string;
};
```

Worker record:

```ts
type WorkerRecord = {
  workerId: string;
  ownerKind: "user" | "system";
  ownerId: string;
  deviceName: string;
  capabilities: string[];
  tokenHash: string;
  status: "online" | "offline" | "revoked";
  lastSeenAt: string;
};
```

CLI local config must support multiple connections:

```ts
type LocalWorkerConnection = {
  connectionId: string;
  appBaseUrl: string;
  appName: string;
  ownerKind: "user" | "system";
  ownerId: string;
  workerId: string;
  endpointMap: Record<string, string>;
  tokenStorageKey: string;
};
```

A developer may connect the same machine to multiple host apps or multiple accounts. `codexdock start` should select a connection explicitly or use a clear default from local config.

## 8. Invocation Model

Invocation record:

```ts
type InvocationRecord = {
  invocationId: string;
  ownerKind: "user" | "system";
  ownerId: string;
  workerId?: string;
  type: "generate_text" | "generate_object" | "generate_file" | "generate_image";
  input?: unknown;
  instructions?: string;
  prompt?: string;
  parameters: JsonObject;
  options?: GenerationOptions;
  responseFormat?: CodexDockResponseFormat;
  requiredCapabilities: string[];
  status: "pending" | "running" | "completed" | "failed" | "expired" | "cancelled";
  result?: unknown;
  error?: CodexDockError;
  attempts: number;
  idempotencyKey?: string;
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
  expiresAt?: string;
};
```

Claim rule:

```sql
where owner_kind = worker.owner_kind
  and owner_id = worker.owner_id
  and status = 'pending'
  and required_capabilities are supported by worker.capabilities
```

Claim should be atomic. SQL adapters should use row locking such as `for update skip locked` or an equivalent transactional mechanism. Non-SQL adapters must provide the same single-claim guarantee.

When multiple workers are connected for the same owner, the first implementation may use simple FIFO claim order. Later implementations can add priority, worker load, or capability preference.

Worker availability policy should be host-configurable:

```ts
type WorkerAvailabilityPolicy = "queue" | "reject";
```

- `queue`: create pending invocation even if no matching worker is online.
- `reject`: return `WORKER_OFFLINE` when no owner-scoped worker with required capabilities is online.

The recommended first behavior is `queue`, because it matches the local worker model and lets users start their worker after creating work.

Result rule:

```text
accept result only if:
  token resolves to worker
  invocation exists
  invocation.owner == worker.owner
  invocation.workerId == worker.workerId
  invocation.status == running
  result schema is valid
```

## 9. Generation Result Contracts

### 9.1 Text

```json
{
  "kind": "text",
  "text": "Generated text...",
  "parameters": {},
  "provider": "codexdock",
  "model": "local-codex",
  "usage": {
    "inputTokens": null,
    "outputTokens": null,
    "totalTokens": null,
    "source": "unavailable"
  }
}
```

### 9.2 Object

```json
{
  "kind": "object",
  "object": {},
  "parameters": {},
  "schemaName": "SceneCards",
  "schemaHash": "sha256:..."
}
```

`generate_object` must be validated before persistence. Saygo or another host app can validate `result.object` again with its own Zod schema before applying domain behavior.

### 9.3 File

Small local/dev:

```json
{
  "kind": "file",
  "filename": "README.md",
  "mediaType": "text/markdown",
  "encoding": "utf-8",
  "content": "# Project\n\n...",
  "parameters": {}
}
```

Production:

```json
{
  "kind": "file",
  "filename": "README.md",
  "mediaType": "text/markdown",
  "artifactId": "art_123",
  "url": "https://storage.example.com/...",
  "storagePath": "codexdock/artifacts/art_123",
  "parameters": {}
}
```

### 9.4 Image

Request:

```ts
await codexdock.generateImage({
  prompt: "Create a square thumbnail for a language-learning scene.",
  size: "1024x1024",
  quality: "high",
  format: "png",
  parameters: {
    usage: "scene_thumbnail",
    sceneId: "scene_123"
  },
  context: { request },
});
```

Small local/dev:

```json
{
  "kind": "image",
  "mediaType": "image/png",
  "encoding": "base64",
  "base64": "...",
  "parameters": {
    "usage": "scene_thumbnail",
    "sceneId": "scene_123"
  }
}
```

Production:

```json
{
  "kind": "image",
  "artifacts": [
    {
      "kind": "image",
      "mediaType": "image/png",
      "artifactId": "art_123",
      "url": "https://storage.example.com/...",
      "storagePath": "codexdock/artifacts/art_123",
      "width": 1024,
      "height": 1024
    }
  ],
  "parameters": {
    "usage": "scene_thumbnail",
    "sceneId": "scene_123"
  }
}
```

## 10. Artifact Upload

Final `worker/result` should stay JSON-only in production.

### Multipart flow

```text
worker -> POST artifact multipart/form-data
host -> stores binary and returns artifactId/url/storagePath
worker -> POST result JSON referencing artifact
```

### Signed upload flow

```text
worker -> POST artifact prepare JSON metadata
host -> signed upload URL
worker -> PUT/POST binary to storage
worker -> POST result JSON referencing artifact
```

The host app chooses which flow it supports through the discovery manifest.

## 11. Persistence Interfaces

The SDK should not force Prisma, Supabase, Postgres, or a framework.

Core adapters:

```ts
interface CodexDockPersistence {
  createInvocation(input): Promise<InvocationRecord>;
  getInvocation(invocationId): Promise<InvocationRecord | null>;
  getInvocationForOwner(input: {
    invocationId: string;
    ownerKind: "user" | "system";
    ownerId: string;
  }): Promise<InvocationRecord | null>;
  listInvocationsByOwner(owner): Promise<InvocationRecord[]>;
  claimNextInvocation(input: {
    workerId: string;
    ownerKind: "user" | "system";
    ownerId: string;
    capabilities: string[];
  }): Promise<InvocationRecord | null>;
  completeInvocation(input): Promise<InvocationRecord>;
  failInvocation(input): Promise<InvocationRecord>;
  createPairingSession(input): Promise<PairingSession>;
  claimPairingSession(input): Promise<PairingSession>;
  approvePairingSession(input): Promise<WorkerRecord>;
  upsertWorker(input): Promise<WorkerRecord>;
  getWorkerByTokenHash(tokenHash): Promise<WorkerRecord | null>;
  revokeWorker(workerId): Promise<WorkerRecord>;
}
```

Token lookup should be outside generic invocation CRUD if the host app wants separate secret storage:

```ts
interface CodexDockTokenStore {
  hashToken(token: string): Promise<string>;
  findWorkerByTokenHash(tokenHash: string): Promise<WorkerRecord | null>;
  storeWorkerTokenHash(input: {
    workerId: string;
    ownerKind: "user" | "system";
    ownerId: string;
    tokenHash: string;
  }): Promise<void>;
  revokeWorkerToken(workerId: string): Promise<void>;
}
```

For the in-memory smoke adapter, persistence and token store can be implemented by the same object. Production adapters may split them.

Production packages can later provide adapters:

- `@codexdock/prisma`
- `@codexdock/postgres`
- `@codexdock/supabase`

The in-memory adapter remains example/smoke only.

## 12. Security Requirements

- Worker tokens are high entropy.
- Store token hashes only.
- Token lookup returns worker owner scope.
- Client-provided `ownerId` is never trusted.
- Pairing sessions have short TTLs.
- Pairing must be approved by the signed-in owner.
- Worker claim is owner-scoped and capability-scoped.
- Worker result submission checks owner, claim, status, and schema.
- App-facing status/result reads are owner-scoped.
- Route paths are not security boundaries.
- Generated artifacts have media type, size, and owner checks.
- System owner usage is explicit and auditable.

## 13. Development Phases

### Phase 0: Consolidate Protocol

- [x] Add `ownerKind` and `ownerId` to invocation, worker, pairing, and result-relevant schemas.
- [x] Add `generate_text`.
- [x] Keep `generate_object`, `generate_file`, `generate_image` as active invoke types.
- [x] Remove all `generate_data` compatibility paths.
- [x] Add text result schema.
- [x] Add object result schema.
- [ ] Add response format, options, required capabilities, and provider/model metadata.
- [x] Add explicit `current` versus `planned` status notes to docs before exposing new APIs in README.

### Phase 1: Owner-Scoped Persistence

- [x] Update memory persistence to store owner scope.
- [x] Add owner-scoped list/status helpers.
- [x] Add owner-scoped invocation read helper.
- [x] Add owner-scoped claim filtering.
- [ ] Add worker token hash lookup.
- [ ] Add pairing session storage.
- [x] Add multi-connection local config shape for CLI.
- [x] Add tests for cross-owner isolation.

### Phase 2: Host SDK API

- [x] Add `resolveOwner(request)` option.
- [x] Add explicit system owner support.
- [ ] Add `responses.create()`.
- [ ] Add `generateText()`.
- [ ] Add `generateObject()`.
- [ ] Add `generateFile()`.
- [ ] Add `generateImage()`.
- [x] Normalize all helpers into owner-scoped invocation records.

### Phase 3: Discovery And Framework-Neutral Handlers

- [x] Add manifest schema.
- [x] Add `codexdock.handlers.discovery`.
- [ ] Let host apps declare endpoint paths.
- [x] Update CLI connect to read endpoint map.
- [ ] Keep Next.js example as one adapter/example, not the only shape.
- [ ] Add docs for Express/Hono/Fastify-style mounting.

### Phase 3.5: User-Facing README And Docs

- [x] Rewrite the root README from the host-app developer's perspective.
- [x] Make README explain the user-scoped runtime model first.
- [x] Show the minimal install/connect/run flow.
- [x] Show `generate_text`, `generate_object`, `generate_image`, and `generate_file` examples.
- [x] Explain that route paths are host-defined through discovery, not fixed by CodexDock.
- [x] Explain production worker tokens as owner-scoped; keep a single env token only as local example wording.
- [x] Move deep architecture, adapter, persistence, and artifact-upload details into docs files.
- [x] Add a "current MVP status" section so README does not imply unfinished APIs already work.

### Phase 4: Pairing And Worker Tokens

- [ ] Implement pairing start/claim/approve.
- [ ] Bind pairing to owner scope.
- [ ] Ensure CLI can claim only an existing pairing code, not create arbitrary owner scope.
- [ ] Issue worker token scoped to host app + owner + worker.
- [ ] Store token securely on CLI side.
- [ ] Store token hash server-side.
- [ ] Add revoke path.

### Phase 5: Worker Routing And Capabilities

- [x] Worker announces capabilities on connect.
- [x] `worker/next` resolves worker from token, not body owner fields.
- [x] `worker/next` returns only same-owner pending work.
- [x] `worker/next` checks required capabilities.
- [x] `worker/result` enforces same owner + claimed worker + running status.
- [x] Add QA for two users/two workers isolation.

### Phase 6: Structured Generation Enforcement

- [x] Add `generate_text` adapter contract.
- [x] Add `generate_object` strict object envelope.
- [ ] Convert Zod schemas to JSON Schema at SDK boundary.
- [ ] Persist schema name/hash.
- [x] Revalidate object result before persistence.
- [x] Attach original parameters server-side.

### Phase 7: Artifact Upload

- [ ] Add artifact record schema with owner scope.
- [ ] Add multipart upload endpoint helper.
- [ ] Add signed upload prepare helper.
- [ ] Update worker result to reference artifacts in production.
- [ ] Validate artifact media type, size, owner, and invocation relation.

### Phase 8: Ledger And Host Wrappers

- [ ] Add invocation ledger fields: provider, model, owner, worker, capabilities, options, usage, artifacts.
- [ ] Document Saygo wrapper pattern.
- [ ] Ensure Saygo can write `ai_call_ledger` with `provider = codexdock`, `model = local-codex`.
- [ ] Ensure Saygo revalidates `result.object` or artifact references with its own Zod schemas.

### Phase 9: Events And Streaming

- [ ] Add invocation event storage.
- [ ] Add polling event API.
- [ ] Add optional SSE adapter.
- [ ] Keep final result schema validation mandatory.

Tool calling remains planned but should not block the owner-scoped SDK/runtime MVP.

## 14. QA Matrix

Minimum QA before this architecture is considered real:

- [x] User A worker cannot claim User B invocation.
- [x] User A worker cannot submit result for User B invocation.
- [x] User A cannot read User B invocation status/result by guessing an id.
- [x] Worker token revoked means `worker/next` and `worker/result` fail.
- [x] Browser-supplied owner is ignored or rejected.
- [x] System owner job does not mix with user owner jobs.
- [x] Worker without `generate_image` does not receive image jobs.
- [x] `generate_object` invalid result is rejected before persistence.
- [ ] Artifact upload for User A cannot attach to User B invocation.
- [x] Discovery manifest lets CLI connect without hard-coded `/api/codexdock/*`.
- [x] CLI can store/select more than one host/owner connection.
- [x] Example app still supports local smoke flow.

## 15. First Implementation Cut

The first real implementation cut should do only this:

1. Owner-scoped protocol and memory persistence.
2. Owner-scoped worker token verification.
3. Owner-scoped `worker/next` and `worker/result`.
4. `generate_text` result schema and owner-scoped validation for the existing `generate_object` result schema.
5. `generateImage` stays inline/base64 for smoke, with artifact upload documented but not required.
6. Discovery manifest shape added, even if the example still mounts default routes.
7. README updated to match the new owner-scoped SDK shape and clearly label current versus planned capabilities.
8. CLI config can represent multiple owner-scoped connections, even if the example uses one default connection.

After that, add production artifact upload and framework adapters.
