# codexdock

Local CLI worker for CodexDock.

The CLI connects a host web app to a local Codex runtime. It polls the host app for pending invocations, runs them with the Codex SDK adapter, and submits results back to the app.

## Install

```bash
pnpm add -g codexdock
```

Or run with `pnpm dlx`:

```bash
pnpm dlx codexdock doctor
```

## Commands

```bash
codexdock connect <server-url> --code <pairing-code> [--owner-kind user|system] [--owner-id <id>]
codexdock start [--connection <id>]
codexdock status [--connection <id>]
codexdock logout
codexdock doctor
```

`connect` reads the host app's discovery manifest when available and stores that endpoint map in `~/.codexdock/config.json`. The config can hold multiple host/owner connections; use `--connection <id>` to select one.

## Local Development Worker

```bash
CODEXDOCK_SERVER_URL=http://localhost:4321 \
CODEXDOCK_WORKER_TOKEN=dev-worker-token \
CODEXDOCK_OWNER_KIND=system \
CODEXDOCK_OWNER_ID=local-dev \
codexdock start --codex-workdir /path/to/project
```

For a non-git development folder:

```bash
codexdock start \
  --codex-workdir /path/to/project \
  --skip-git-repo-check
```

## Status

The current pairing flow has a development token mode. Owner-scoped connection storage, discovery, and worker polling are implemented. Production pairing approval, token hashing, secure token storage, and revoke flows are planned.
