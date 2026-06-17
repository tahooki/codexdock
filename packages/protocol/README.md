# @codexdock/protocol

Shared protocol types and runtime schemas for CodexDock.

This package contains the invocation, worker, error, and event schemas used by the CodexDock SDK, CLI, and adapters.

## Install

```bash
pnpm add @codexdock/protocol
```

## Usage

```ts
import {
  CODEXDOCK_PROTOCOL_VERSION,
  invokeRequestSchema,
  invocationRecordSchema,
  makeCodexDockError,
} from "@codexdock/protocol";

const request = invokeRequestSchema.parse({
  type: "generate_data",
  prompt: "Create product card data.",
  payload: { count: 4 },
});

console.log(CODEXDOCK_PROTOCOL_VERSION, request);
```

## Status

CodexDock is early-stage software. Protocol details may change before a stable release.
