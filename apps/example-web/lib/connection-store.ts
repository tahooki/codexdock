import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  CodexDockHttpError,
  makeCodexDockError,
  type CodexDockOwner,
} from "@codexdock/sdk";
import {
  ensureCodexDockSchema,
  getSql,
  hasDatabaseConnection,
} from "./postgres-persistence";

const pairingTtlMs = 5 * 60 * 1000;
const fallbackWorkerToken = process.env.CODEXDOCK_WORKER_TOKEN ?? "dev-worker-token";

type PairingExchange = CodexDockOwner & {
  workerId: string;
  workerToken: string;
};

interface ConnectionStore {
  createPairingCode(owner: CodexDockOwner): Promise<{ code: string; expiresAt: string }>;
  exchangePairingCode(code: string, workerId: string): Promise<PairingExchange | null>;
  ownerForWorkerToken(token: string): Promise<CodexDockOwner | null>;
  revokeWorkerTokens(owner: CodexDockOwner, workerId: string): Promise<void>;
}

type MemoryPairingCodeRecord = CodexDockOwner & { expiresAt: string; usedAt?: string };
type MemoryWorkerTokenRecord = CodexDockOwner & { workerId: string; revokedAt?: string };

const globalForConnectionStore = globalThis as unknown as {
  codexDockConnectionStore?: ConnectionStore;
  codexDockMemoryPairingCodes?: Map<string, MemoryPairingCodeRecord>;
  codexDockMemoryWorkerTokens?: Map<string, MemoryWorkerTokenRecord>;
};

const memoryPairingCodes =
  globalForConnectionStore.codexDockMemoryPairingCodes ?? new Map<string, MemoryPairingCodeRecord>();
const memoryWorkerTokens =
  globalForConnectionStore.codexDockMemoryWorkerTokens ?? new Map<string, MemoryWorkerTokenRecord>();

globalForConnectionStore.codexDockMemoryPairingCodes = memoryPairingCodes;
globalForConnectionStore.codexDockMemoryWorkerTokens = memoryWorkerTokens;

export function getConnectionStore(): ConnectionStore {
  globalForConnectionStore.codexDockConnectionStore ??= hasDatabaseConnection()
    ? createPostgresConnectionStore()
    : createMemoryConnectionStore();
  return globalForConnectionStore.codexDockConnectionStore;
}

export async function createPairingCode(owner: CodexDockOwner) {
  return getConnectionStore().createPairingCode(owner);
}

export async function exchangePairingCode(code: string, workerId: string) {
  return getConnectionStore().exchangePairingCode(code, workerId);
}

export async function authenticateWorkerToken(request: Request): Promise<CodexDockOwner> {
  const token = bearerToken(request);
  if (!token) {
    throw new CodexDockHttpError(
      401,
      makeCodexDockError("WORKER_AUTH_INVALID", "Missing worker token."),
    );
  }

  if (isDevWorkerTokenAllowed() && safeEqual(token, fallbackWorkerToken)) {
    return { ownerKind: "system", ownerId: "local-dev" };
  }

  const owner = await getConnectionStore().ownerForWorkerToken(token);
  if (!owner) {
    throw new CodexDockHttpError(
      401,
      makeCodexDockError("WORKER_AUTH_INVALID", "Invalid worker token."),
    );
  }
  return owner;
}

function createMemoryConnectionStore(): ConnectionStore {
  return {
    async createPairingCode(owner) {
      const code = createCode("cdock");
      memoryPairingCodes.set(hashSecret(code), {
        ...owner,
        expiresAt: new Date(Date.now() + pairingTtlMs).toISOString(),
      });
      return { code, expiresAt: memoryPairingCodes.get(hashSecret(code))?.expiresAt ?? "" };
    },

    async exchangePairingCode(code, workerId) {
      const codeHash = hashSecret(code);
      const record = memoryPairingCodes.get(codeHash);
      if (!record || record.usedAt || new Date(record.expiresAt).getTime() <= Date.now()) {
        return null;
      }

      record.usedAt = new Date().toISOString();
      const workerToken = createCode("cdwk");
      await this.revokeWorkerTokens(record, workerId);
      memoryWorkerTokens.set(hashSecret(workerToken), {
        ownerKind: record.ownerKind,
        ownerId: record.ownerId,
        workerId,
      });
      return {
        ownerKind: record.ownerKind,
        ownerId: record.ownerId,
        workerId,
        workerToken,
      };
    },

    async ownerForWorkerToken(token) {
      const record = memoryWorkerTokens.get(hashSecret(token));
      if (!record || record.revokedAt) return null;
      return { ownerKind: record.ownerKind, ownerId: record.ownerId };
    },

    async revokeWorkerTokens(owner, workerId) {
      const revokedAt = new Date().toISOString();
      for (const record of memoryWorkerTokens.values()) {
        if (record.ownerKind === owner.ownerKind && record.ownerId === owner.ownerId && record.workerId === workerId) {
          record.revokedAt = revokedAt;
        }
      }
    },
  };
}

function createPostgresConnectionStore(): ConnectionStore {
  return {
    async createPairingCode(owner) {
      await ensureCodexDockSchema();
      const code = createCode("cdock");
      const expiresAt = new Date(Date.now() + pairingTtlMs).toISOString();
      await getSql()`
        INSERT INTO codexdock_pairing_codes (code_hash, owner_kind, owner_id, expires_at)
        VALUES (${hashSecret(code)}, ${owner.ownerKind}, ${owner.ownerId}, ${expiresAt})
      `;
      return { code, expiresAt };
    },

    async exchangePairingCode(code, workerId) {
      await ensureCodexDockSchema();
      const workerToken = createCode("cdwk");
      const rows = asRows(await getSql()`
        UPDATE codexdock_pairing_codes
        SET used_at = NOW()
        WHERE code_hash = ${hashSecret(code)}
          AND used_at IS NULL
          AND expires_at > NOW()
        RETURNING owner_kind, owner_id
      `);
      const row = rows[0] as { owner_kind?: unknown; owner_id?: unknown } | undefined;
      if (typeof row?.owner_kind !== "string" || typeof row.owner_id !== "string") return null;
      const owner: CodexDockOwner = {
        ownerKind: row.owner_kind === "system" ? "system" : "user",
        ownerId: row.owner_id,
      };

      await this.revokeWorkerTokens(owner, workerId);

      await getSql()`
        INSERT INTO codexdock_worker_tokens (token_hash, owner_kind, owner_id, worker_id)
        VALUES (${hashSecret(workerToken)}, ${owner.ownerKind}, ${owner.ownerId}, ${workerId})
      `;

      return {
        ownerKind: owner.ownerKind,
        ownerId: owner.ownerId,
        workerId,
        workerToken,
      };
    },

    async ownerForWorkerToken(token) {
      await ensureCodexDockSchema();
      const rows = asRows(await getSql()`
        SELECT owner_kind, owner_id
        FROM codexdock_worker_tokens
        WHERE token_hash = ${hashSecret(token)}
          AND revoked_at IS NULL
        LIMIT 1
      `);
      const row = rows[0] as { owner_kind?: unknown; owner_id?: unknown } | undefined;
      if (typeof row?.owner_kind !== "string" || typeof row.owner_id !== "string") return null;
      return {
        ownerKind: row.owner_kind === "system" ? "system" : "user",
        ownerId: row.owner_id,
      };
    },

    async revokeWorkerTokens(owner, workerId) {
      await ensureCodexDockSchema();
      await getSql()`
        UPDATE codexdock_worker_tokens
        SET revoked_at = NOW()
        WHERE owner_kind = ${owner.ownerKind}
          AND owner_id = ${owner.ownerId}
          AND worker_id = ${workerId}
          AND revoked_at IS NULL
      `;
    },
  };
}

function bearerToken(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match?.[1]?.trim() ?? "";
}

function createCode(prefix: string) {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isDevWorkerTokenAllowed() {
  return process.env.CODEXDOCK_ALLOW_DEV_WORKER_TOKEN === "true" || process.env.NODE_ENV !== "production";
}

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}
