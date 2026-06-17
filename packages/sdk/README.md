# @codexdock/sdk

Server-side SDK for routing app AI invocations to local CodexDock workers.

Use this package inside a host web app. It stores invocations through a persistence adapter, exposes route-handler helpers, and lets local workers claim work and submit results.

## Install

```bash
pnpm add @codexdock/sdk
```

## Basic Usage

```ts
import {
  createCodexDock,
  createMemoryPersistence,
} from "@codexdock/sdk";

export const codexdock = createCodexDock({
  persistence: createMemoryPersistence(),
  workerToken: process.env.CODEXDOCK_WORKER_TOKEN,
});

const invocation = await codexdock.invoke({
  type: "generate_data",
  prompt: "Create product card data.",
  payload: { count: 4 },
});

console.log(invocation.invocationId);
```

## Next.js Route Handlers

```ts
export const POST = codexdock.handlers.invoke;
```

Worker endpoints are also exposed through `codexdock.handlers.workerConnect`, `workerNext`, `workerResult`, and `workerStatus`.

## Status

The in-memory persistence adapter is intended for examples and local smoke tests. Production apps should provide their own database-backed persistence adapter.
