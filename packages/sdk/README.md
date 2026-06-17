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
  appName: "Your App",
  persistence: createMemoryPersistence(),
  defaultOwner: { ownerKind: "system", ownerId: "local-dev" },
  workerOwner: { ownerKind: "system", ownerId: "local-dev" },
  workerToken: process.env.CODEXDOCK_WORKER_TOKEN,
});

const invocation = await codexdock.invoke({
  type: "generate_object",
  prompt: "Create product card data.",
  parameters: { count: 4, usage: "admin-preview" },
});

console.log(invocation.invocationId);
```

`parameters` is stored with the invocation and echoed into completed results. `payload` is still accepted as a compatibility alias.

For product routes, use `resolveOwner(request)` so CodexDock uses the owner from your app's session or auth context:

```ts
export const codexdock = createCodexDock({
  appName: "Your App",
  persistence,
  workerToken: process.env.CODEXDOCK_WORKER_TOKEN,
  workerOwner: { ownerKind: "user", ownerId: "user_123" },
  resolveOwner: async (request) => ({
    ownerKind: "user",
    ownerId: await requireUserId(request),
  }),
});
```

## Next.js Route Handlers

```ts
export const GET = codexdock.handlers.discovery;
export const POST = codexdock.handlers.invoke;
```

Worker endpoints are also exposed through `codexdock.handlers.workerConnect`, `workerNext`, `workerResult`, and `workerStatus`.

Routes can be mounted at the host app's preferred paths. Publish `codexdock.handlers.discovery` so the CLI can read the endpoint map instead of assuming a fixed route layout.

## Security

`workerToken` is required by default. Worker routes reject requests that do not include `Authorization: Bearer <token>`.

Protect your app-facing invoke route with your own product auth, quota checks, and rate limits. CodexDock authenticates local workers, but the host app decides which users are allowed to create jobs.

The current SDK supports owner-scoped memory persistence and a single configured `workerOwner` per SDK instance. Production apps should back this with token lookup that returns the token's owner scope.

## Status

The in-memory persistence adapter is intended for examples and local smoke tests. Production apps should provide their own database-backed persistence adapter. Pairing approval, token hashing, revocation, and large artifact upload helpers are planned next.
