#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConsoleEventSink, createAdapter, MemoryEventSink } from "@codexdock/codex-adapter";
import { makeCodexDockError } from "@codexdock/protocol";
import type { WorkerNextResponse } from "@codexdock/protocol";

interface CliConfig {
  serverUrl: string;
  workerId: string;
  workerToken: string;
}

const configDir = join(homedir(), ".codexdock");
const configPath = join(configDir, "config.json");

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";

  if (command === "connect") {
    await connectCommand(args.slice(1));
    return;
  }

  if (command === "start" || command === "worker") {
    await startCommand(args.slice(1));
    return;
  }

  if (command === "status") {
    await statusCommand();
    return;
  }

  if (command === "logout") {
    await logoutCommand();
    return;
  }

  if (command === "doctor") {
    await doctorCommand(args.slice(1));
    return;
  }

  printHelp();
}

async function connectCommand(args: string[]) {
  const serverUrl = args[0] ?? process.env.CODEXDOCK_SERVER_URL;
  if (!serverUrl) {
    throw new Error("Usage: codexdock connect <server-url> --code <pairing-code>");
  }

  const options = parseFlags(args.slice(1));
  const workerId = options["worker-id"] ?? process.env.CODEXDOCK_WORKER_ID ?? "local-dev-worker";
  const workerToken =
    options.token ??
    process.env.CODEXDOCK_WORKER_TOKEN ??
    (options.code ? "dev-worker-token" : undefined);

  if (!workerToken) {
    throw new Error("Missing worker token. For dev, set CODEXDOCK_WORKER_TOKEN or pass --token.");
  }

  const config = { serverUrl, workerId, workerToken };
  await saveConfig(config);
  console.log(`Connected ${workerId} to ${serverUrl}`);
}

async function startCommand(args: string[]) {
  const options = parseFlags(args);
  const config = await loadConfigWithEnv();
  const adapterKind = (options.adapter as "fake" | "sdk" | undefined) ?? adapterKindFromEnv();
  const adapter = createAdapter(adapterKind, codexAdapterOptions(options));
  const deviceName = options["device-name"] ?? "local-dev";
  const capabilities = ["json_result", adapterKind === "sdk" ? "codex_sdk" : "fake_runner"];

  const connect = await postJson<{ polling?: { emptyMinMs?: number; emptyMaxMs?: number } }>(
    config,
    "/api/codexdock/worker/connect",
    {
      workerId: config.workerId,
      deviceName,
      capabilities,
    },
  );

  let delayMs = connect.polling?.emptyMinMs ?? 2_000;
  const maxDelayMs = connect.polling?.emptyMaxMs ?? 30_000;

  console.log(`worker online: ${config.workerId}`);
  console.log(`server: ${config.serverUrl}`);

  while (true) {
    try {
      const invocation = await nextInvocation(config);
      if (!invocation) {
        await sleep(withJitter(delayMs));
        delayMs = Math.min(Math.round(delayMs * 1.5), maxDelayMs);
        continue;
      }

      delayMs = connect.polling?.emptyMinMs ?? 2_000;
      console.log(`claimed ${invocation.invocationId} (${invocation.type})`);

      try {
        const events = new MemoryEventSink();
        const result = await adapter.invoke(invocation, events);
        await postJson(config, "/api/codexdock/worker/result", {
          workerId: config.workerId,
          invocationId: invocation.invocationId,
          ok: true,
          result: result.result,
        });
        console.log(`completed ${invocation.invocationId}`);
      } catch (error) {
        await postJson(config, "/api/codexdock/worker/result", {
          workerId: config.workerId,
          invocationId: invocation.invocationId,
          ok: false,
          error: makeCodexDockError(
            "CODEX_RUN_FAILED",
            error instanceof Error ? error.message : "Codex invocation failed.",
            { retryable: true },
          ),
        });
        console.error(`failed ${invocation.invocationId}:`, error instanceof Error ? error.message : error);
      }
    } catch (error) {
      console.error("worker loop error:", error instanceof Error ? error.message : error);
      await sleep(withJitter(5_000));
    }
  }
}

async function statusCommand() {
  const config = await loadConfigWithEnv();
  const status = await getJson<unknown>(config, "/api/codexdock/worker/status");
  console.log(JSON.stringify(status, null, 2));
}

async function logoutCommand() {
  await rm(configPath, { force: true });
  console.log("Logged out.");
}

async function doctorCommand(args: string[]) {
  const options = parseFlags(args);
  const adapter = createAdapter(
    (options.adapter as "fake" | "sdk" | undefined) ?? adapterKindFromEnv(),
    codexAdapterOptions(options),
  );
  const result = await adapter.doctor();
  console.log(JSON.stringify(result, null, 2));
}

async function nextInvocation(config: CliConfig): Promise<WorkerNextResponse | null> {
  const response = await fetch(new URL("/api/codexdock/worker/next", config.serverUrl), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ workerId: config.workerId }),
  });

  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as WorkerNextResponse;
}

async function getJson<T>(config: CliConfig, path: string): Promise<T> {
  const response = await fetch(new URL(path, config.serverUrl), {
    headers: headers(config),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

async function postJson<T>(config: CliConfig, path: string, body: unknown): Promise<T> {
  const response = await fetch(new URL(path, config.serverUrl), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

function headers(config: CliConfig) {
  return {
    authorization: `Bearer ${config.workerToken}`,
    "content-type": "application/json",
  };
}

async function saveConfig(config: CliConfig) {
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

async function loadConfigWithEnv(): Promise<CliConfig> {
  const serverUrl = process.env.CODEXDOCK_SERVER_URL;
  const workerToken = process.env.CODEXDOCK_WORKER_TOKEN;
  const workerId = process.env.CODEXDOCK_WORKER_ID ?? "local-dev-worker";

  if (serverUrl && workerToken) {
    return { serverUrl, workerToken, workerId };
  }

  const text = await readFile(configPath, "utf8");
  return JSON.parse(text) as CliConfig;
}

function parseFlags(args: string[]): Record<string, string | undefined> {
  const output: Record<string, string | undefined> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      output[key] = "true";
      continue;
    }
    output[key] = next;
    index += 1;
  }
  return output;
}

function adapterKindFromEnv(): "fake" | "sdk" {
  return process.env.CODEXDOCK_ADAPTER === "sdk" ? "sdk" : "fake";
}

function codexAdapterOptions(options: Record<string, string | undefined>) {
  return {
    workingDirectory: options["codex-workdir"] ?? process.env.CODEXDOCK_CODEX_WORKDIR,
    skipGitRepoCheck:
      options["skip-git-repo-check"] === "true" ||
      process.env.CODEXDOCK_CODEX_SKIP_GIT_REPO_CHECK === "true",
  };
}

function withJitter(ms: number): number {
  return ms + Math.floor(Math.random() * 500);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`CodexDock

Commands:
  codexdock connect <server-url> --code <pairing-code>
  codexdock start [--adapter fake|sdk] [--codex-workdir <path>] [--skip-git-repo-check]
  codexdock status
  codexdock logout
  codexdock doctor [--adapter fake|sdk]

Dev env:
  CODEXDOCK_SERVER_URL=http://localhost:4321
  CODEXDOCK_WORKER_TOKEN=dev-worker-token
  CODEXDOCK_CODEX_WORKDIR=/path/to/project
  CODEXDOCK_CODEX_SKIP_GIT_REPO_CHECK=true
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
