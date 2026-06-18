import { createCodexDock, createMemoryPersistence, type CodexDockPersistence } from "@codexdock/sdk";
import { authenticateWorkerToken } from "./connection-store";
import { ownerFromRequest } from "./owner";
import {
  createPostgresPersistence,
  hasDatabaseConnection,
} from "./postgres-persistence";

export const codexDockOwner = {
  ownerKind: process.env.CODEXDOCK_OWNER_KIND === "user" ? "user" : "system",
  ownerId: process.env.CODEXDOCK_OWNER_ID ?? "local-dev",
} as const;

const globalForCodexDock = globalThis as unknown as {
  codexDockPersistence?: CodexDockPersistence;
  codexDock?: ReturnType<typeof createCodexDock>;
};

export const persistence =
  globalForCodexDock.codexDockPersistence ??
  (hasDatabaseConnection() ? createPostgresPersistence() : createMemoryPersistence());

globalForCodexDock.codexDockPersistence = persistence;

export const codexdock =
  globalForCodexDock.codexDock ??
  createCodexDock({
    persistence,
    appName: "CodexDock Example Web",
    defaultOwner: codexDockOwner,
    resolveOwner: ownerFromRequest,
    resolveWorkerAuth: authenticateWorkerToken,
  });

globalForCodexDock.codexDock = codexdock;
