# codexdock

Local CLI worker for CodexDock.

The CLI connects a host web app to a local Codex runtime. It polls the host app for pending invocations, runs them with a fake adapter or the Codex SDK adapter, and submits results back to the app.

## Install

```bash
pnpm add -g codexdock
```

Or run with `pnpm dlx`:

```bash
pnpm dlx codexdock doctor --adapter fake
```

## Commands

```bash
codexdock connect <server-url> --code <pairing-code>
codexdock start [--adapter fake|sdk]
codexdock status
codexdock logout
codexdock doctor [--adapter fake|sdk]
```

## Local Development Worker

```bash
CODEXDOCK_SERVER_URL=http://localhost:4321 \
CODEXDOCK_WORKER_TOKEN=dev-worker-token \
codexdock start --adapter fake
```

## Codex SDK Worker

```bash
CODEXDOCK_SERVER_URL=http://localhost:4321 \
CODEXDOCK_WORKER_TOKEN=dev-worker-token \
codexdock start \
  --adapter sdk \
  --codex-workdir /path/to/project
```

For a non-git development folder:

```bash
codexdock start \
  --adapter sdk \
  --codex-workdir /path/to/project \
  --skip-git-repo-check
```

## Status

The current pairing flow has a development token mode. Production pairing, token hashing, and revoke flows are planned.
