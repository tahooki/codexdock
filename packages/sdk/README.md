# @codexdock/sdk

Server-side SDK and protocol schemas for routing app AI invocations to local CodexDock workers.

Use this package inside a host web app. It stores invocations through a persistence adapter, exposes route-handler helpers, exports shared protocol types and Zod schemas, and lets local workers claim work and submit results.

Need the local worker? Install [`codexdock`](https://www.npmjs.com/package/codexdock). The CLI connects to the routes exposed by this SDK and runs pending invocations through the local Codex runtime.

## Documentation

- [CodexDock documentation](https://codexdock.tahooki.com)
- [API docs](https://codexdock.tahooki.com/api-docs)

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
console.log(invocation.progress.phase);
```

`parameters` is stored with the invocation and echoed into completed results. `payload` is still accepted as a compatibility alias.

`invoke()`, `getInvocation()`, and worker result responses include a derived `progress` snapshot with `received`, `processing`, and `result` steps. Use `progress.phase` for broad states such as `queued`, `processing`, `completed`, and `failed`, and use each step's `status` to render a compact progress UI.

For product routes, use `resolveOwner(request)` so CodexDock uses the owner from your app's session or auth context:

```ts
export const codexdock = createCodexDock({
  appName: "Your App",
  persistence,
  resolveOwner: async (request) => ({
    ownerKind: "user",
    ownerId: await requireOwnerId(request),
  }),
  resolveWorkerAuth: async (request) => await requireWorkerOwnerFromToken(request),
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

Worker authentication is required by default. Use a single `workerToken` for local examples, or `resolveWorkerAuth(request)` for production token lookup. Worker routes reject requests that do not include a valid `Authorization: Bearer <token>` header.

Protect your app-facing invoke route with your own product auth, quota checks, and rate limits. CodexDock authenticates local workers, but the host app decides which users are allowed to create jobs.

Production apps should issue high-entropy worker tokens per owner/worker, store hashes, and have `resolveWorkerAuth(request)` return the token's owner scope.

## Status

The in-memory persistence adapter is intended for examples and local smoke tests. Production apps should provide their own database-backed persistence adapter. Revocation UI and large artifact upload helpers are planned next.
