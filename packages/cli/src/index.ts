#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAdapter, MemoryEventSink } from "@codexdock/codex-adapter";
import type { CodexDockOwner, DiscoveryManifest, WorkerNextResponse } from "@codexdock/protocol";
import {
  discoveryManifestSchema,
  makeCodexDockError,
} from "@codexdock/protocol";

type EndpointKey =
  | "discovery"
  | "invoke"
  | "getInvocation"
  | "workerStatus"
  | "workerConnect"
  | "workerNext"
  | "workerResult"
  | "artifactUpload"
  | "artifactPrepare";

type EndpointMap = Partial<Record<EndpointKey, string>>;

interface LocalWorkerConnection extends CodexDockOwner {
  connectionId: string;
  appName?: string;
  serverUrl: string;
  workerId: string;
  workerToken: string;
  endpoints?: EndpointMap;
}

interface CliConfigFile {
  version: 1;
  defaultConnectionId: string;
  connections: LocalWorkerConnection[];
}

type CliConfig = LocalWorkerConnection;

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
    await statusCommand(args.slice(1));
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
  const ownerKind = parseOwnerKind(
    options["owner-kind"] ?? process.env.CODEXDOCK_OWNER_KIND ?? "system",
  );
  const ownerId = options["owner-id"] ?? process.env.CODEXDOCK_OWNER_ID ?? "local-dev";
  const workerId = options["worker-id"] ?? process.env.CODEXDOCK_WORKER_ID ?? "local-dev-worker";
  const workerToken =
    options.token ??
    process.env.CODEXDOCK_WORKER_TOKEN ??
    (options.code ? "dev-worker-token" : undefined);

  if (!workerToken) {
    throw new Error("Missing worker token. For dev, set CODEXDOCK_WORKER_TOKEN or pass --token.");
  }

  const normalizedServerUrl = normalizeUrl(serverUrl);
  const discovered =
    options["skip-discovery"] === "true"
      ? null
      : await discoverHost(normalizedServerUrl, options["discovery-url"]);
  const connection: LocalWorkerConnection = {
    connectionId:
      options["connection-id"] ??
      defaultConnectionId(normalizedServerUrl, ownerKind, ownerId, workerId),
    appName: discovered?.appName,
    serverUrl: normalizedServerUrl,
    ownerKind,
    ownerId,
    workerId,
    workerToken,
    endpoints: discovered?.endpoints,
  };

  await saveConnection(connection);
  console.log(`Connected ${workerId} to ${normalizedServerUrl}`);
  console.log(`owner: ${ownerKind}:${ownerId}`);
  if (connection.appName) console.log(`app: ${connection.appName}`);
}

async function startCommand(args: string[]) {
  const options = parseFlags(args);
  const config = await loadConfigWithEnv(options.connection);
  const adapterKind = (options.adapter as "fake" | "sdk" | undefined) ?? adapterKindFromEnv();
  const adapter = createAdapter(adapterKind, codexAdapterOptions(options));
  const deviceName = options["device-name"] ?? "local-dev";
  const capabilities = [
    "generate_text",
    "generate_object",
    "generate_file",
    "generate_image",
    "json_result",
    adapterKind === "sdk" ? "codex_sdk" : "fake_runner",
  ];

  const connect = await postJson<{ polling?: { emptyMinMs?: number; emptyMaxMs?: number } }>(
    config,
    "workerConnect",
    "/api/codexdock/worker/connect",
    {
      workerId: config.workerId,
      ownerKind: config.ownerKind,
      ownerId: config.ownerId,
      deviceName,
      capabilities,
    },
  );

  let delayMs = connect.polling?.emptyMinMs ?? 2_000;
  const maxDelayMs = connect.polling?.emptyMaxMs ?? 30_000;

  console.log(`worker online: ${config.workerId}`);
  console.log(`server: ${config.serverUrl}`);
  console.log(`owner: ${config.ownerKind}:${config.ownerId}`);

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
        await postJson(config, "workerResult", "/api/codexdock/worker/result", {
          workerId: config.workerId,
          invocationId: invocation.invocationId,
          ok: true,
          result: result.result,
        });
        console.log(`completed ${invocation.invocationId}`);
      } catch (error) {
        await postJson(config, "workerResult", "/api/codexdock/worker/result", {
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

async function statusCommand(args: string[]) {
  const options = parseFlags(args);
  const config = await loadConfigWithEnv(options.connection);
  const status = await getJson<unknown>(config, "workerStatus", "/api/codexdock/worker/status");
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
  const response = await fetch(endpointUrl(config, "workerNext", "/api/codexdock/worker/next"), {
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

async function getJson<T>(config: CliConfig, endpoint: EndpointKey, path: string): Promise<T> {
  const response = await fetch(endpointUrl(config, endpoint, path), {
    headers: headers(config),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

async function postJson<T>(
  config: CliConfig,
  endpoint: EndpointKey,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(endpointUrl(config, endpoint, path), {
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

async function discoverHost(
  serverUrl: string,
  explicitDiscoveryUrl?: string,
): Promise<Pick<LocalWorkerConnection, "appName" | "endpoints"> | null> {
  const discoveryUrl = explicitDiscoveryUrl
    ? normalizeUrl(explicitDiscoveryUrl)
    : new URL("/api/codexdock/discovery", serverUrl).toString();

  try {
    const response = await fetch(discoveryUrl);
    if (!response.ok) throw new Error(`Discovery returned ${response.status}.`);
    const manifest = discoveryManifestSchema.parse(await response.json());
    return {
      appName: manifest.appName,
      endpoints: endpointsFromManifest(manifest),
    };
  } catch (error) {
    console.warn(
      `Discovery skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function endpointsFromManifest(manifest: DiscoveryManifest): EndpointMap {
  return {
    discovery: manifest.endpoints.discovery,
    invoke: manifest.endpoints.invoke,
    getInvocation: manifest.endpoints.getInvocation,
    workerStatus: manifest.endpoints.workerStatus,
    workerConnect: manifest.endpoints.workerConnect,
    workerNext: manifest.endpoints.workerNext,
    workerResult: manifest.endpoints.workerResult,
    artifactUpload: manifest.endpoints.artifactUpload,
    artifactPrepare: manifest.endpoints.artifactPrepare,
  };
}

function endpointUrl(config: CliConfig, endpoint: EndpointKey, fallbackPath: string): URL {
  const configured = config.endpoints?.[endpoint];
  if (configured) return new URL(configured);
  return new URL(fallbackPath, config.serverUrl);
}

async function saveConnection(connection: LocalWorkerConnection) {
  await mkdir(configDir, { recursive: true });
  const existing = await readConfigFile();
  const connections = existing.connections.filter(
    (item) => item.connectionId !== connection.connectionId,
  );
  connections.push(connection);
  const nextConfig: CliConfigFile = {
    version: 1,
    defaultConnectionId: connection.connectionId,
    connections,
  };
  await writeFile(configPath, JSON.stringify(nextConfig, null, 2), "utf8");
}

async function loadConfigWithEnv(connectionId?: string): Promise<CliConfig> {
  const serverUrl = process.env.CODEXDOCK_SERVER_URL;
  const workerToken = process.env.CODEXDOCK_WORKER_TOKEN;
  const workerId = process.env.CODEXDOCK_WORKER_ID ?? "local-dev-worker";
  const ownerKind = parseOwnerKind(process.env.CODEXDOCK_OWNER_KIND ?? "system");
  const ownerId = process.env.CODEXDOCK_OWNER_ID ?? "local-dev";

  if (serverUrl && workerToken) {
    const normalizedServerUrl = normalizeUrl(serverUrl);
    return {
      connectionId:
        process.env.CODEXDOCK_CONNECTION_ID ??
        defaultConnectionId(normalizedServerUrl, ownerKind, ownerId, workerId),
      serverUrl: normalizedServerUrl,
      workerToken,
      workerId,
      ownerKind,
      ownerId,
    };
  }

  const config = await readConfigFile();
  const selectedId = connectionId ?? process.env.CODEXDOCK_CONNECTION_ID ?? config.defaultConnectionId;
  const selected = config.connections.find((item) => item.connectionId === selectedId);
  if (!selected) {
    throw new Error(`CodexDock connection not found: ${selectedId}`);
  }
  return selected;
}

async function readConfigFile(): Promise<CliConfigFile> {
  try {
    const text = await readFile(configPath, "utf8");
    return normalizeConfigFile(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { version: 1, defaultConnectionId: "", connections: [] };
    }
    throw error;
  }
}

function normalizeConfigFile(value: unknown): CliConfigFile {
  if (isCliConfigFile(value)) return value;
  if (isLegacyConfig(value)) {
    const serverUrl = normalizeUrl(value.serverUrl);
    const ownerKind = parseOwnerKind(value.ownerKind ?? "system");
    const ownerId = value.ownerId ?? "local-dev";
    const connection: LocalWorkerConnection = {
      connectionId: defaultConnectionId(serverUrl, ownerKind, ownerId, value.workerId),
      serverUrl,
      ownerKind,
      ownerId,
      workerId: value.workerId,
      workerToken: value.workerToken,
    };
    return {
      version: 1,
      defaultConnectionId: connection.connectionId,
      connections: [connection],
    };
  }

  throw new Error("Invalid CodexDock CLI config.");
}

function isCliConfigFile(value: unknown): value is CliConfigFile {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as CliConfigFile).connections)
  );
}

function isLegacyConfig(value: unknown): value is {
  serverUrl: string;
  workerId: string;
  workerToken: string;
  ownerKind?: string;
  ownerId?: string;
} {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { serverUrl?: unknown }).serverUrl === "string" &&
    typeof (value as { workerId?: unknown }).workerId === "string" &&
    typeof (value as { workerToken?: unknown }).workerToken === "string"
  );
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

function parseOwnerKind(value: string): CodexDockOwner["ownerKind"] {
  if (value === "user" || value === "system") return value;
  throw new Error("owner-kind must be user or system.");
}

function normalizeUrl(value: string): string {
  return new URL(value).toString();
}

function defaultConnectionId(
  serverUrl: string,
  ownerKind: CodexDockOwner["ownerKind"],
  ownerId: string,
  workerId: string,
): string {
  return `${serverUrl}|${ownerKind}:${ownerId}|${workerId}`;
}

function adapterKindFromEnv(): "fake" | "sdk" {
  return process.env.CODEXDOCK_ADAPTER === "fake" ? "fake" : "sdk";
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
  codexdock connect <server-url> --code <pairing-code> [--owner-kind user|system] [--owner-id <id>]
  codexdock start [--connection <id>] [--adapter sdk|fake] [--codex-workdir <path>] [--skip-git-repo-check]
  codexdock status [--connection <id>]
  codexdock logout
  codexdock doctor [--adapter sdk|fake]

Dev env:
  CODEXDOCK_SERVER_URL=http://localhost:4321
  CODEXDOCK_WORKER_TOKEN=dev-worker-token
  CODEXDOCK_OWNER_KIND=system
  CODEXDOCK_OWNER_ID=local-dev
  CODEXDOCK_ADAPTER=sdk
  CODEXDOCK_CODEX_WORKDIR=/path/to/project
  CODEXDOCK_CODEX_SKIP_GIT_REPO_CHECK=true
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
