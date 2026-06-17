# CodexDock

CodexDock is an SDK and CLI worker for routing app AI tasks to a local Codex runtime instead of calling the OpenAI API directly from a web service.

The host app creates an invocation with `@codexdock/sdk`. A local `codexdock` worker connects outbound to the host app, claims pending invocations, runs them through a local Codex adapter, and submits the result back to the host app.

## Packages

- `@codexdock/sdk`: server-side SDK for host web apps
- `codexdock`: local CLI worker
- `@codexdock/protocol`: shared protocol types and schemas
- `@codexdock/codex-adapter`: fake and Codex SDK adapters for workers

## Development

```bash
pnpm install
pnpm check
pnpm build
pnpm qa:smoke
```

Run the example app:

```bash
pnpm dev
```

Run a local fake worker:

```bash
CODEXDOCK_SERVER_URL=http://localhost:4321 \
CODEXDOCK_WORKER_TOKEN=dev-worker-token \
pnpm --filter codexdock worker
```

Run a local Codex SDK worker:

```bash
CODEXDOCK_SERVER_URL=http://localhost:4321 \
CODEXDOCK_WORKER_TOKEN=dev-worker-token \
pnpm --filter codexdock exec codexdock start \
  --adapter sdk \
  --codex-workdir /path/to/project
```

For a non-git development folder, add `--skip-git-repo-check`.

## Documentation

- [Development spec and TODO](docs/codexdock-development-spec-and-todo.md)
- [Planning document](docs/codexdock-planning-and-development.md)
- [npm publish guide](docs/npm-publish-guide.md)
