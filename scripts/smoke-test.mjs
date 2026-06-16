import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const root = new URL("..", import.meta.url);
const serverUrl = "http://127.0.0.1:4321";

const server = spawn("pnpm", ["--filter", "@codexdock/example-web", "dev"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: "4321" },
});

const logs = [];
let worker;
server.stdout.on("data", (chunk) => logs.push(chunk.toString()));
server.stderr.on("data", (chunk) => logs.push(chunk.toString()));

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${serverUrl}/api/codexdock/worker/status`);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await sleep(500);
  }
  throw new Error("Example server did not become ready.");
}

async function main() {
  try {
    await waitForServer();

    worker = spawn("pnpm", ["--filter", "codexdock", "worker"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEXDOCK_SERVER_URL: serverUrl,
        CODEXDOCK_WORKER_TOKEN: "dev-worker-token",
      },
    });
    worker.stdout.on("data", (chunk) => logs.push(chunk.toString()));
    worker.stderr.on("data", (chunk) => logs.push(chunk.toString()));

    await waitForWorker();

    const invokeResponse = await fetch(`${serverUrl}/api/codexdock/invoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "generate_data",
        prompt: "Create three product cards for CodexDock",
        payload: { count: 3 },
      }),
    });

    if (!invokeResponse.ok) {
      throw new Error(`Invoke failed with ${invokeResponse.status}`);
    }

    const invoke = await invokeResponse.json();
    const statusUrl = `${serverUrl}${invoke.statusUrl}`;

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const statusResponse = await fetch(statusUrl);
      const status = await statusResponse.json();
      if (status.invocation?.status === "completed") {
        console.log("smoke ok", status.invocation.invocationId);
        return;
      }
      if (status.invocation?.status === "failed") {
        throw new Error(`Invocation failed: ${JSON.stringify(status.invocation.error)}`);
      }
      await sleep(500);
    }

    throw new Error("Invocation did not complete in time.");
  } catch (error) {
    console.error(logs.join(""));
    throw error;
  } finally {
    worker?.kill("SIGTERM");
    server.kill("SIGTERM");
  }
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${serverUrl}/api/codexdock/worker/status`);
    if (response.ok) {
      const status = await response.json();
      if (status.workers?.length > 0) return;
    }
    if (worker?.exitCode !== null) {
      throw new Error("Worker exited before connecting.");
    }
    await sleep(500);
  }
  throw new Error("Worker did not connect.");
}

await main();
