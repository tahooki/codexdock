# @codexdock/protocol

Shared protocol types and runtime schemas for CodexDock.

This package contains the owner-scoped invocation, worker, discovery, result, error, and event schemas used by the CodexDock SDK, CLI, and adapters.

## Install

```bash
pnpm add @codexdock/protocol
```

## Usage

```ts
import {
  invokeRequestSchema,
  invocationRecordSchema,
  makeCodexDockError,
} from "@codexdock/protocol";

const request = invokeRequestSchema.parse({
  ownerKind: "system",
  ownerId: "local-dev",
  type: "generate_object",
  prompt: "Create product card data.",
  parameters: { count: 4, usage: "admin-preview" },
});

console.log(request);
```

## Status

CodexDock is early-stage software. Protocol details may change before a stable release.
