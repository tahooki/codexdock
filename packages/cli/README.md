# codexdock

Local CLI worker for CodexDock.

The CLI connects a host web app to a local Codex runtime. It polls the host app for pending invocations, runs them with its built-in Codex SDK adapter, and submits results back to the app.

Building the host app side? Install [`@codexdock/sdk`](https://www.npmjs.com/package/@codexdock/sdk). The SDK exposes the route handlers, protocol schemas, and persistence interfaces that the `codexdock` CLI worker connects to.

## Documentation

- [CodexDock documentation](https://codexdock.tahooki.com)
- [API docs](https://codexdock.tahooki.com/api-docs)

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
codexdock connect <server-url> --code <pairing-code>
codexdock start [--connection <id>]
codexdock status [--connection <id>]
codexdock logout [--keep-env]
codexdock doctor
codexdock version
```

`connect` reads the host app's discovery manifest when available, exchanges the pairing code for an owner-scoped worker token, and stores that endpoint map in `~/.codexdock/config.json`. Each successful `connect` becomes the default connection used by the next `codexdock start`; if a previous worker token is revoked by the host, the old worker exits instead of retrying forever. The config can hold multiple host/owner connections; use `--connection <id>` to select one.

`logout` removes saved connections and, by default, makes `start` and `status` ignore `CODEXDOCK_SERVER_URL` and `CODEXDOCK_WORKER_TOKEN` fallback values until the next successful `connect`. Use `logout --keep-env` only when you intentionally want dev environment credentials to remain usable.

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

Owner-scoped connection storage, discovery, pairing-code exchange, and worker polling are implemented. Development token mode is still available for local smoke tests. Revoke flows and richer approval UI are planned.
