# @codexdock/codex-adapter

Codex adapter layer for CodexDock workers.

This package provides:

- `FakeCodexAdapter` for local examples and smoke tests
- `SdkCodexAdapter` for running work through `@openai/codex-sdk`
- shared adapter interfaces and event sinks

## Install

```bash
pnpm add @codexdock/codex-adapter
```

## Usage

```ts
import { createAdapter, MemoryEventSink } from "@codexdock/codex-adapter";

const adapter = createAdapter("sdk", {
  workingDirectory: "/path/to/project",
});

const events = new MemoryEventSink();
const result = await adapter.invoke(
  {
    invocationId: "inv_123",
    type: "generate_data",
    prompt: "Return a small JSON summary.",
    payload: {},
  },
  events,
);

console.log(result);
```

For non-git development folders, pass `skipGitRepoCheck: true`.

## Status

Codex SDK execution is functional, but structured JSON result enforcement and finer auth/error classification are still TODO.
