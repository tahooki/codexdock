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
    type: "generate_object",
    prompt: "Return a small JSON summary.",
    parameters: { usage: "adapter-test" },
  },
  events,
);

console.log(result);
```

For non-git development folders, pass `skipGitRepoCheck: true`.

## Status

The adapter validates `generate_text`, `generate_object`, `generate_file`, and `generate_image` result envelopes before returning them to the worker loop. Finer Codex auth/error classification is still planned.
