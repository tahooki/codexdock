# OpenAI API Inspired Generation Plan

Reviewed: 2026-06-17

## 1. Purpose

CodexDock should not become a wire-compatible `/v1/*` OpenAI proxy. It should, however, feel familiar to developers who already use AI generation APIs.

The target is:

- OpenAI-like request concepts
- CodexDock-native async worker execution
- user-scoped local Codex workers by default
- host-defined routes and auth
- schema-validated results
- artifact-aware file/image transport
- ledger-friendly metadata

OpenAI documentation reviewed for this plan:

- [Responses API create reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Text generation guide](https://developers.openai.com/api/docs/guides/text)
- [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Function calling guide](https://developers.openai.com/api/docs/guides/function-calling)
- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [Images API reference](https://developers.openai.com/api/reference/resources/images)

## 2. Design Position

CodexDock is an async job bridge:

```text
host app -> CodexDock invocation -> local worker -> Codex runtime -> validated result -> host app
```

It borrows OpenAI API concepts, not OpenAI endpoint paths.

Do not require host apps to expose fixed public routes such as `/v1/responses`. CodexDock should provide SDK handlers, protocol schemas, and framework adapters that a host app can mount at any route it chooses.

## 2.1 Owner Scope

Generation is owner-scoped by default.

CodexDock is not mainly "one service connects one Codex account and all users share it." The primary product model is:

```text
signed-in user -> user's connected local Codex worker -> user's Codex runtime
```

Every production invocation should have an owner:

```ts
type CodexDockOwner = {
  ownerKind: "user" | "system";
  ownerId: string;
};
```

Rules:

- User-facing AI requests use the current user's owner scope.
- A worker token is scoped to one host app, owner, and worker.
- `worker/next` only returns invocations for that worker's owner.
- `worker/result` only accepts results for invocations claimed by that owner-scoped worker.
- A system-owned worker is allowed for explicit back-office or scheduled automation, but it is a separate owner scope such as `{ ownerKind: "system", ownerId: "system_default" }`.
- The server derives `ownerId` from host app auth/session or a trusted system job, not from arbitrary browser input.

## 3. Non-Goals

- Do not claim full OpenAI API compatibility.
- Do not implement embeddings, fine-tuning, realtime audio, Batch API, or Assistants API in the first generation layer.
- Do not execute host app tools automatically from a local worker.
- Do not store large binary/base64 artifacts in invocation rows for production.
- Do not treat route secrecy as security.
- Do not make a shared service-wide Codex account the default execution model for user-facing AI features.

## 4. Terminology

CodexDock needs a clear split between business context and model options.

### `parameters`

Host-defined business context. CodexDock stores it and echoes it into the final result.

Examples:

```json
{
  "usage": "scene_thumbnail",
  "sceneId": "scene_123",
  "characterId": "char_456"
}
```

CodexDock should not interpret these values except for validation and persistence. The host app decides what they mean.

### `options`

Generation controls inspired by AI APIs.

Examples:

```json
{
  "temperature": 0.4,
  "maxOutputTokens": 800,
  "reasoning": {
    "effort": "medium"
  }
}
```

Adapters may support only part of this object. Unsupported fields must be returned in metadata or ledger details as ignored/unsupported.

### `metadata`

Operational labels for logs, search, tracing, and ledger entries. Metadata is not the same as `parameters`; it should not be used by the host app to decide where a result belongs.

## 5. Public SDK Shape

Use one advanced API plus focused helpers.

```ts
await codexdock.responses.create({
  input: "Write a short scene intro.",
  instructions: "Be concise.",
  responseFormat: { type: "text" },
  options: { maxOutputTokens: 500 },
  parameters: {
    usage: "scene_intro",
    sceneId: "scene_123"
  }
});
```

Helper APIs:

```ts
await codexdock.generateText(input);
await codexdock.generateObject(input);
await codexdock.generateFile(input);
await codexdock.generateImage(input);
```

All helpers compile down to the same invocation protocol.

## 6. Generation Types

Use these user-facing generation types:

- `generate_text`
- `generate_object`
- `generate_file`
- `generate_image`

Result kinds:

- `text`
- `object`
- `file`
- `image`

Avoid `generate_image_plan`. If an app wants image prompt review or prompt improvement, that should be a `generate_text` or `generate_object` task whose `parameters.usage` says what the host should do with it.

## 7. Capability Negotiation

The server must not assume every worker can handle every generation type.

Workers should announce capabilities when connecting:

```json
{
  "workerId": "worker_123",
  "ownerKind": "user",
  "ownerId": "user_123",
  "capabilities": [
    "generate_text",
    "generate_object",
    "generate_file",
    "generate_image",
    "artifact_upload.multipart",
    "artifact_upload.signed"
  ]
}
```

Dispatch rules:

- `generate_text` requires `generate_text`.
- `generate_object` requires `generate_object` and schema validation support.
- `generate_file` requires `generate_file`.
- production `generate_file` with binary output requires an artifact upload capability.
- `generate_image` requires `generate_image`.
- production `generate_image` requires an artifact upload capability.

If no connected worker supports a requested type, the SDK should either keep the invocation pending with a clear `requiredCapabilities` field or reject it immediately, depending on host policy.

## 8. Text Generation

Support both string input and chat-style messages.

```ts
await codexdock.generateText({
  input: "Write a short admin prompt preview.",
  options: {
    temperature: 0.4,
    maxOutputTokens: 500
  },
  parameters: {
    usage: "admin_prompt_preview"
  }
});
```

```ts
await codexdock.generateText({
  instructions: "You are a concise story editor.",
  input: [
    { role: "user", content: "Rewrite this dialogue to sound natural." }
  ],
  parameters: {
    usage: "dialogue_rewrite",
    sceneId: "scene_123"
  }
});
```

Result:

```json
{
  "kind": "text",
  "text": "Generated output...",
  "parameters": {
    "usage": "dialogue_rewrite",
    "sceneId": "scene_123"
  },
  "finishReason": "completed",
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

If an adapter can provide exact token usage, it should fill those fields. If it cannot, it must say `source: "unavailable"` or `source: "estimated"`.

## 9. Structured Object Generation

JSON/object generation must be schema-first. Prompt-only JSON generation is not enough for application flows.

OpenAI's Structured Outputs concept should become CodexDock's default structured generation model:

```ts
await codexdock.generateObject({
  instructions: "Create product cards.",
  input: "Generate cards for a docs page.",
  schema: z.object({
    items: z.array(z.object({
      title: z.string(),
      description: z.string(),
      cta: z.string()
    }))
  }),
  parameters: {
    usage: "admin_preview"
  }
});
```

Protocol form:

```json
{
  "type": "generate_object",
  "input": "Generate cards for a docs page.",
  "responseFormat": {
    "type": "json_schema",
    "name": "ProductCards",
    "schema": {},
    "strict": true
  },
  "parameters": {
    "usage": "admin_preview"
  }
}
```

Result:

```json
{
  "kind": "object",
  "object": {
    "items": []
  },
  "parameters": {
    "usage": "admin_preview"
  },
  "schemaName": "ProductCards",
  "schemaHash": "sha256:...",
  "finishReason": "completed",
  "provider": "codexdock",
  "model": "local-codex"
}
```

The SDK must revalidate the final object before persistence. For Saygo, this means CodexDock validates the generic result envelope, then the Saygo wrapper validates the returned object against Saygo's Zod schema.

`json_object` mode can exist as a loose compatibility option, but production app flows should prefer `json_schema` with `strict: true`.

## 10. File Generation

File generation returns an artifact envelope.

```ts
await codexdock.generateFile({
  input: "Draft a concise README.",
  filename: "README.md",
  mediaType: "text/markdown",
  parameters: {
    usage: "repo_doc"
  }
});
```

Small local/dev result:

```json
{
  "kind": "file",
  "summary": "Generated README.md.",
  "parameters": {
    "usage": "repo_doc"
  },
  "filename": "README.md",
  "mediaType": "text/markdown",
  "encoding": "utf-8",
  "content": "# Project\n\n..."
}
```

Production result:

```json
{
  "kind": "file",
  "summary": "Generated README.md.",
  "parameters": {
    "usage": "repo_doc"
  },
  "filename": "README.md",
  "mediaType": "text/markdown",
  "artifactId": "art_123",
  "url": "https://host-storage.example/...",
  "storagePath": "codexdock/artifacts/art_123"
}
```

## 11. Image Generation

Image generation should use familiar image options, but the result should remain artifact-oriented.

The helper can use `prompt` because that is natural for image APIs. Internally it can normalize to `input`.

```ts
await codexdock.generateImage({
  prompt: "Create a square thumbnail for a language-learning scene.",
  size: "1024x1024",
  quality: "high",
  format: "png",
  background: "auto",
  parameters: {
    usage: "scene_thumbnail",
    sceneId: "scene_123"
  }
});
```

Small local/dev result:

```json
{
  "kind": "image",
  "summary": "Generated image artifact.",
  "parameters": {
    "usage": "scene_thumbnail",
    "sceneId": "scene_123"
  },
  "filename": "scene-thumbnail.png",
  "mediaType": "image/png",
  "encoding": "base64",
  "base64": "...",
  "promptUsed": "Create a square thumbnail for a language-learning scene."
}
```

Production result:

```json
{
  "kind": "image",
  "parameters": {
    "usage": "scene_thumbnail",
    "sceneId": "scene_123"
  },
  "artifacts": [
    {
      "kind": "image",
      "mediaType": "image/png",
      "artifactId": "art_123",
      "url": "https://host-storage.example/...",
      "storagePath": "codexdock/artifacts/art_123",
      "width": 1024,
      "height": 1024
    }
  ],
  "provider": "codexdock",
  "model": "local-codex"
}
```

## 12. Artifact Transport

Inline base64 is acceptable only for smoke tests and small local development outputs.

Production should use one of these flows.

### Multipart upload

```text
worker -> POST /worker/artifacts multipart/form-data -> host storage -> artifact record
worker -> POST /worker/result JSON with artifactId/url/storagePath
```

Use this when the host app wants CodexDock to receive the binary and handle storage.

### Signed upload

```text
worker -> POST /worker/artifacts/prepare JSON metadata
host -> signed upload URL
worker -> PUT/POST binary to storage
worker -> POST /worker/result JSON with artifactId/url/storagePath
```

Use this when the host app already has S3, Supabase Storage, R2, GCS, or another object store.

Final `worker/result` should stay JSON-only. It should reference uploaded artifacts instead of carrying large binary content.

## 13. Generation Options

Provider-neutral options:

```ts
type GenerationOptions = {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  reasoning?: {
    effort?: "minimal" | "low" | "medium" | "high";
    summary?: "auto" | "concise" | "detailed";
  };
  seed?: number;
  stop?: string[];
  stream?: boolean;
  metadata?: Record<string, string>;
};
```

Rules:

- persist requested options
- pass supported options to the adapter
- record unsupported options in result/ledger details
- never pretend unsupported options were applied

## 14. Tool Calling

OpenAI function calling lets a model request application-defined functions using JSON schemas. CodexDock should support that shape but keep execution under host control.

Important distinction:

- invocation `parameters` = host business context
- tool `parameters` = JSON Schema for a function's arguments

Initial protocol:

```json
{
  "tools": [
    {
      "type": "function",
      "name": "lookup_scene",
      "description": "Look up scene metadata.",
      "parameters": {
        "type": "object",
        "properties": {
          "sceneId": { "type": "string" }
        },
        "required": ["sceneId"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "toolChoice": "auto"
}
```

Phase 1:

- allow tool definitions in request
- allow adapter/model result to include `toolCalls`
- persist tool calls
- let the host app decide how to execute or reject them

Phase 2:

- add explicit host-approved tool execution loop
- submit each tool result as a new invocation step
- ledger every tool call and tool result

Do not let the local worker directly call arbitrary host functions.

## 15. Streaming and Events

OpenAI supports streaming. CodexDock should expose streaming as invocation events, not as a long blocking `invoke` request.

Flow:

```text
invoke -> returns invocationId
worker -> emits progress/output events
host UI -> polls or subscribes to events
worker -> submits final validated result
```

Possible events:

```json
{ "type": "output_text.delta", "delta": "hello" }
{ "type": "tool_call.created", "toolCall": {} }
{ "type": "artifact.uploaded", "artifactId": "art_123" }
{ "type": "response.completed" }
```

Possible SDK helper:

```ts
codexdock.handlers.events
```

SSE can be added as a framework adapter feature. Polling should remain available because some deployments do not support durable streaming well.

## 16. Protocol Types

```ts
type CodexDockGenerationType =
  | "generate_text"
  | "generate_object"
  | "generate_file"
  | "generate_image";
```

```ts
type CodexDockResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      name: string;
      schema: JsonObject;
      strict?: boolean;
    };
```

```ts
type CodexDockMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | CodexDockContentPart[];
};
```

```ts
type CodexDockContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; imageUrl?: string; artifactId?: string; mediaType?: string }
  | { type: "input_file"; fileUrl?: string; artifactId?: string; mediaType?: string };
```

```ts
type CodexDockGenerationRequest = {
  type: CodexDockGenerationType;
  input?: string | CodexDockMessage[];
  instructions?: string;
  responseFormat?: CodexDockResponseFormat;
  tools?: CodexDockTool[];
  toolChoice?: "auto" | "none" | "required" | { type: "function"; name: string };
  options?: GenerationOptions;
  parameters?: JsonObject;
  idempotencyKey?: string;
};
```

## 17. Adapter Contract

Adapters receive a normalized request:

```ts
interface CodexAdapterRequest {
  invocationId: string;
  type: CodexDockGenerationType;
  input: string | CodexDockMessage[];
  instructions?: string;
  responseFormat: CodexDockResponseFormat;
  tools: CodexDockTool[];
  toolChoice: CodexDockToolChoice;
  options: GenerationOptions;
  parameters: JsonObject;
}
```

Adapters return one of:

```ts
type CodexAdapterResult =
  | GeneratedTextResult
  | GeneratedObjectResult
  | GeneratedFileResult
  | GeneratedImageResult;
```

The SDK must revalidate the result before persistence.

## 18. Ledger Requirements

Every invocation should record:

- provider: `codexdock`
- model: adapter-reported model, default `local-codex`
- type: `generate_text`, `generate_object`, `generate_file`, `generate_image`
- request schema hash if structured output is used
- original `parameters`
- required capabilities
- requested options
- supported options applied by adapter
- unsupported options ignored by adapter
- worker id
- start/end timestamps
- status and error code
- usage tokens if available
- artifact ids if any
- owner kind and owner id

For Saygo, the wrapper can write `ai_call_ledger` with `provider = codexdock` and `model = local-codex`, while still validating the final object against Saygo's own Zod schema.

## 19. Security and Validation

- Worker endpoints require scoped worker auth.
- Worker tokens must be scoped to host app, owner, and worker.
- Invocations must be claimed only by workers in the same owner scope.
- Workers can only submit results for invocations they claimed.
- The server must derive owner scope from trusted auth/session context or trusted system job context.
- `parameters` must be copied from the original invocation by the server, not trusted from worker output.
- `generate_object` must be validated against its schema before persistence.
- artifact media type and size must be validated server-side.
- tool calls must be stored and approved by the host app before execution.
- route paths are not a security boundary.
- worker capabilities must be checked before dispatch.

## 20. Migration Plan

MVP should stop after text/object/file/image result contracts and basic artifact upload. Tool calling and streaming should stay planned but out of the first implementation cut.

### Phase 1: Protocol cleanup

- Add `generate_text`.
- Add `generate_object`.
- Add `input`, `instructions`, `responseFormat`, `options`, and `parameters`.
- Add result schemas for text and object.

### Phase 2: SDK helpers

- Add `codexdock.responses.create()`.
- Add `generateText()`, `generateObject()`, `generateImage()`, `generateFile()`.
- Normalize helper calls into invocation records.
- Preserve existing `invoke()` for low-level compatibility.

### Phase 3: Structured output enforcement

- Convert Zod schemas to JSON Schema at the SDK boundary.
- Persist schema name/hash with invocation.
- Ask adapter to return strict JSON.
- Revalidate adapter output with Zod or JSON Schema before saving.
- Return `INVALID_PAYLOAD` if the final result does not match.

### Phase 4: Artifact upload

- Add multipart artifact upload or signed upload preparation.
- Store final results as artifact references.
- Keep inline artifacts only for local smoke tests and tiny dev outputs.

### Phase 5: Events and streaming

- Add invocation event persistence.
- Add `handlers.events` for SSE or polling.
- Worker emits deltas and progress events.
- Final result still goes through schema enforcement.

### Phase 6: Tool-call shape

- Add tool definition schemas.
- Allow `toolCalls` in result.
- Host app executes tool calls only through explicit, server-approved handlers.

## 21. Decision

CodexDock should offer an OpenAI-inspired generation SDK centered on:

- Responses-style input
- schema-first object generation
- async invocation status
- server-side result validation
- parameter echo for host post-processing
- artifact references for files and images

It should not promise OpenAI wire compatibility. The compatibility goal is familiar developer ergonomics and comparable generation primitives, not identical endpoint behavior.
