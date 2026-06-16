import { createCodexDock, createMemoryPersistence } from "@codexdock/sdk";

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
    workerToken: process.env.CODEXDOCK_WORKER_TOKEN ?? "dev-worker-token",
  });

globalForCodexDock.codexDock = codexdock;
