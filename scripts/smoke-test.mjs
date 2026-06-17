import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createCodexDock, createMemoryPersistence } from "../packages/sdk/dist/index.js";

const root = new URL("..", import.meta.url);
const serverUrl = "http://127.0.0.1:4321";
const workerToken = "dev-worker-token";

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
      const response = await fetch(`${serverUrl}/api/codexdock/worker/status`, {
        headers: workerHeaders(),
      });
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
    await assertOwnerIsolation();
    await waitForServer();
    await assertDiscovery();

    worker = spawn("pnpm", ["--filter", "codexdock", "worker"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEXDOCK_SERVER_URL: serverUrl,
        CODEXDOCK_WORKER_TOKEN: workerToken,
      },
    });
    worker.stdout.on("data", (chunk) => logs.push(chunk.toString()));
    worker.stderr.on("data", (chunk) => logs.push(chunk.toString()));

    await waitForWorker();

    const textInvocation = await invokeAndWait({
      type: "generate_text",
      prompt: "Write one sentence about CodexDock",
      parameters: { tone: "plain", usage: "smoke-text" },
    });
    if (
      textInvocation.result?.kind !== "text" ||
      typeof textInvocation.result?.text !== "string" ||
      textInvocation.result.text.length === 0 ||
      textInvocation.result?.provider !== "codexdock" ||
      textInvocation.result?.model !== "local-codex" ||
      textInvocation.result?.parameters?.tone !== "plain" ||
      textInvocation.result?.parameters?.usage !== "smoke-text"
    ) {
      throw new Error(
        `Unexpected generate_text result: ${JSON.stringify(textInvocation.result)}`,
      );
    }

    const objectInvocation = await invokeAndWait({
      type: "generate_object",
      prompt: "Create three product cards for CodexDock",
      parameters: { count: 3, usage: "smoke-object" },
    });
    if (
      objectInvocation.result?.kind !== "object" ||
      !Array.isArray(objectInvocation.result?.object?.items) ||
      objectInvocation.result?.parameters?.count !== 3 ||
      objectInvocation.result?.parameters?.usage !== "smoke-object"
    ) {
      throw new Error(
        `Unexpected generate_object result: ${JSON.stringify(objectInvocation.result)}`,
      );
    }

    const imageInvocation = await invokeAndWait({
      type: "generate_image",
      prompt: "Create a square CodexDock thumbnail",
      parameters: { filename: "smoke.png", usage: "smoke-thumbnail" },
    });
    if (
      imageInvocation.result?.kind !== "image" ||
      imageInvocation.result?.mediaType !== "image/png" ||
      imageInvocation.result?.encoding !== "base64" ||
      typeof imageInvocation.result?.base64 !== "string" ||
      imageInvocation.result.base64.length === 0 ||
      imageInvocation.result?.parameters?.filename !== "smoke.png" ||
      imageInvocation.result?.parameters?.usage !== "smoke-thumbnail"
    ) {
      throw new Error(
        `Unexpected generate_image result: ${JSON.stringify(imageInvocation.result)}`,
      );
    }

    console.log(
      "smoke ok",
      textInvocation.invocationId,
      objectInvocation.invocationId,
      imageInvocation.invocationId,
    );
  } catch (error) {
    console.error(logs.join(""));
    throw error;
  } finally {
    worker?.kill("SIGTERM");
    server.kill("SIGTERM");
  }
}

async function assertOwnerIsolation() {
  const persistence = createMemoryPersistence();
  const ownerA = { ownerKind: "user", ownerId: "user-a" };
  const ownerB = { ownerKind: "user", ownerId: "user-b" };
  const dockA = createCodexDock({
    persistence,
    allowInsecureWorkerAuth: true,
    defaultOwner: ownerA,
    workerOwner: ownerA,
    resolveOwner: async () => ownerA,
  });
  const dockB = createCodexDock({
    persistence,
    allowInsecureWorkerAuth: true,
    defaultOwner: ownerB,
    workerOwner: ownerB,
  });

  const routeResponse = await dockA.handlers.invoke(
    new Request("http://localhost/api/codexdock/invoke", {
      method: "POST",
      body: JSON.stringify({
        ownerKind: "user",
        ownerId: "spoofed-user",
        type: "generate_text",
        prompt: "Route owner must come from resolveOwner.",
        parameters: { usage: "owner-route" },
      }),
    }),
  );
  const routeInvocation = await routeResponse.json();
  if (!routeResponse.ok) {
    throw new Error(`Owner route invoke failed: ${JSON.stringify(routeInvocation)}`);
  }
  if (!(await dockA.getInvocation(routeInvocation.invocationId, ownerA))) {
    throw new Error("Route-created invocation was not stored under owner A.");
  }
  if (await dockB.getInvocation(routeInvocation.invocationId, ownerB)) {
    throw new Error("Route-created invocation leaked to owner B.");
  }

  const textA = await dockA.invoke({
    type: "generate_text",
    prompt: "Owner A text.",
    parameters: { usage: "owner-text" },
  });
  await dockA.invoke({
    type: "generate_image",
    prompt: "Owner A image.",
    parameters: { usage: "owner-image" },
  });
  await dockB.invoke({
    type: "generate_text",
    prompt: "Owner B text.",
    parameters: { usage: "owner-b-text" },
  });

  await dockA.workerConnect({
    workerId: "worker-a",
    deviceName: "owner-a",
    capabilities: ["generate_text"],
  });
  await dockB.workerConnect({
    workerId: "worker-b",
    deviceName: "owner-b",
    capabilities: ["generate_text"],
  });

  const nextA = await dockA.workerNext("worker-a");
  if (nextA?.invocationId !== routeInvocation.invocationId) {
    throw new Error(`Owner A worker claimed unexpected invocation: ${JSON.stringify(nextA)}`);
  }

  await expectReject(
    "Owner B result submission for owner A invocation",
    dockB.workerResult({
      workerId: "worker-b",
      invocationId: nextA.invocationId,
      ok: true,
      result: {
        kind: "text",
        text: "cross-owner result",
        provider: "codexdock",
        model: "local-codex",
      },
    }),
  );

  await dockA.workerResult({
    workerId: "worker-a",
    invocationId: nextA.invocationId,
    ok: true,
    result: {
      kind: "text",
      text: "owner A route result",
      provider: "codexdock",
      model: "local-codex",
    },
  });

  const secondA = await dockA.workerNext("worker-a");
  if (secondA?.invocationId !== textA.invocationId) {
    throw new Error(`Owner A worker did not claim owner A text next: ${JSON.stringify(secondA)}`);
  }
  await dockA.workerResult({
    workerId: "worker-a",
    invocationId: secondA.invocationId,
    ok: true,
    result: {
      kind: "text",
      text: "owner A direct result",
      provider: "codexdock",
      model: "local-codex",
    },
  });

  const imageForTextOnlyWorker = await dockA.workerNext("worker-a");
  if (imageForTextOnlyWorker) {
    throw new Error(
      `Text-only worker claimed image job: ${JSON.stringify(imageForTextOnlyWorker)}`,
    );
  }

  const objectA = await dockA.invoke({
    type: "generate_object",
    prompt: "Owner A object.",
    parameters: { usage: "owner-object" },
  });
  await dockA.workerConnect({
    workerId: "worker-object-a",
    deviceName: "owner-a-object",
    capabilities: ["generate_object"],
  });
  const objectNext = await dockA.workerNext("worker-object-a");
  if (objectNext?.invocationId !== objectA.invocationId) {
    throw new Error(`Object worker claimed unexpected invocation: ${JSON.stringify(objectNext)}`);
  }
  await expectReject(
    "Invalid generate_object result",
    dockA.workerResult({
      workerId: "worker-object-a",
      invocationId: objectNext.invocationId,
      ok: true,
      result: {
        kind: "text",
        text: "not an object envelope",
      },
    }),
  );

  const revokedInvocation = await dockA.invoke({
    type: "generate_text",
    prompt: "Owner A revoked worker text.",
    parameters: { usage: "owner-revoked" },
  });
  await dockA.workerConnect({
    workerId: "worker-revoked-a",
    deviceName: "owner-a-revoked",
    capabilities: ["generate_text"],
  });
  const revokedNext = await dockA.workerNext("worker-revoked-a");
  if (revokedNext?.invocationId !== revokedInvocation.invocationId) {
    throw new Error(`Revoked test worker claimed unexpected invocation: ${JSON.stringify(revokedNext)}`);
  }
  await persistence.upsertWorker({
    ownerKind: ownerA.ownerKind,
    ownerId: ownerA.ownerId,
    workerId: "worker-revoked-a",
    deviceName: "owner-a-revoked",
    capabilities: ["generate_text"],
    status: "revoked",
  });
  await expectReject(
    "Revoked worker reconnect",
    dockA.workerConnect({
      workerId: "worker-revoked-a",
      deviceName: "owner-a-revoked",
      capabilities: ["generate_text"],
    }),
  );
  await expectReject(
    "Revoked worker next",
    dockA.workerNext("worker-revoked-a"),
  );
  await expectReject(
    "Revoked worker result",
    dockA.workerResult({
      workerId: "worker-revoked-a",
      invocationId: revokedNext.invocationId,
      ok: true,
      result: {
        kind: "text",
        text: "revoked worker result",
        provider: "codexdock",
        model: "local-codex",
      },
    }),
  );

  const systemOwner = { ownerKind: "system", ownerId: "system-default" };
  const dockSystem = createCodexDock({
    persistence,
    allowInsecureWorkerAuth: true,
    defaultOwner: systemOwner,
    workerOwner: systemOwner,
  });
  const systemInvocation = await dockSystem.invoke({
    type: "generate_text",
    prompt: "System owner text.",
    parameters: { usage: "system-owner" },
  });
  const userWorkerAfterSystem = await dockA.workerNext("worker-a");
  if (userWorkerAfterSystem) {
    throw new Error(`User worker claimed system work: ${JSON.stringify(userWorkerAfterSystem)}`);
  }
  await dockSystem.workerConnect({
    workerId: "worker-system",
    deviceName: "system-worker",
    capabilities: ["generate_text"],
  });
  const systemNext = await dockSystem.workerNext("worker-system");
  if (systemNext?.invocationId !== systemInvocation.invocationId) {
    throw new Error(`System worker failed to claim system work: ${JSON.stringify(systemNext)}`);
  }
  await dockSystem.workerResult({
    workerId: "worker-system",
    invocationId: systemNext.invocationId,
    ok: true,
    result: {
      kind: "text",
      text: "system owner result",
      provider: "codexdock",
      model: "local-codex",
    },
  });

  const nextB = await dockB.workerNext("worker-b");
  if (!nextB || nextB.ownerId !== ownerB.ownerId) {
    throw new Error(`Owner B worker failed to claim owner B work: ${JSON.stringify(nextB)}`);
  }
}

async function expectReject(label, promise) {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error(`${label} should have failed.`);
}

async function assertDiscovery() {
  const response = await fetch(`${serverUrl}/api/codexdock/discovery`);
  if (!response.ok) {
    throw new Error(`Discovery failed with ${response.status}`);
  }
  const manifest = await response.json();
  if (
    manifest.appName !== "CodexDock Example Web" ||
    !manifest.capabilities?.generationTypes?.includes("generate_text") ||
    !manifest.capabilities?.generationTypes?.includes("generate_image") ||
    !manifest.endpoints?.workerNext
  ) {
    throw new Error(`Unexpected discovery manifest: ${JSON.stringify(manifest)}`);
  }
}

async function invokeAndWait(input) {
  const invokeResponse = await fetch(`${serverUrl}/api/codexdock/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
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
      return status.invocation;
    }
    if (status.invocation?.status === "failed") {
      throw new Error(`Invocation failed: ${JSON.stringify(status.invocation.error)}`);
    }
    await sleep(500);
  }

  throw new Error("Invocation did not complete in time.");
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${serverUrl}/api/codexdock/worker/status`, {
      headers: workerHeaders(),
    });
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

function workerHeaders() {
  return { authorization: `Bearer ${workerToken}` };
}

await main();
