import { createCodexDock, createMemoryPersistence } from "@codexdock/sdk";

export const codexDockOwner = {
  ownerKind: process.env.CODEXDOCK_OWNER_KIND === "user" ? "user" : "system",
  ownerId: process.env.CODEXDOCK_OWNER_ID ?? "local-dev",
} as const;

const globalForCodexDock = globalThis as unknown as {
  codexDockPersistence?: ReturnType<typeof createMemoryPersistence>;
  codexDock?: ReturnType<typeof createCodexDock>;
};

export const persistence =
  globalForCodexDock.codexDockPersistence ??
  createMemoryPersistence();

globalForCodexDock.codexDockPersistence = persistence;

export const codexdock =
  globalForCodexDock.codexDock ??
  createCodexDock({
    persistence,
    appName: "CodexDock Example Web",
    defaultOwner: codexDockOwner,
    workerOwner: codexDockOwner,
    workerToken: process.env.CODEXDOCK_WORKER_TOKEN ?? "dev-worker-token",
  });

globalForCodexDock.codexDock = codexdock;
