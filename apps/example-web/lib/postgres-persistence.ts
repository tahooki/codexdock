import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  CodexDockHttpError,
  codexDockErrorSchema,
  invocationRecordSchema,
  makeCodexDockError,
  workerRecordSchema,
  type CodexDockOwner,
  type CodexDockPersistence,
  type CompleteInvocationInput,
  type FailInvocationInput,
  type InvocationRecord,
  type WorkerRecord,
  type WorkerStatusResult,
  withInvocationProgress,
} from "@codexdock/sdk";

type Sql = ReturnType<typeof postgres>;
type Row = Record<string, unknown>;

let sqlClient: Sql | null = null;
let schemaPromise: Promise<void> | null = null;

export function hasDatabaseConnection() {
  return !!databaseUrl();
}

export function getSql() {
  const url = databaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL or POSTGRES_URL is required for CodexDock Postgres storage.");
  }
  sqlClient ??= postgres(url, {
    idle_timeout: 20,
    max: 1,
    prepare: false,
    ssl: shouldUseSsl(url) ? "require" : false,
  });
  return sqlClient;
}

export async function ensureCodexDockSchema() {
  schemaPromise ??= createSchema();
  await schemaPromise;
}

export function createPostgresPersistence(): CodexDockPersistence {
  return {
    async createInvocation(input) {
      await ensureCodexDockSchema();
      const sql = getSql();

      if (input.idempotencyKey) {
        const existing = asRows(await sql`
          SELECT * FROM codexdock_invocations
          WHERE owner_kind = ${input.ownerKind}
            AND owner_id = ${input.ownerId}
            AND idempotency_key = ${input.idempotencyKey}
          LIMIT 1
        `);
        if (existing[0]) return invocationFromRow(existing[0]);
      }

      const invocation = invocationRecordSchema.parse({
        invocationId: input.invocationId ?? `inv_${randomUUID()}`,
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        type: input.type,
        prompt: input.prompt,
        payload: input.payload,
        requiredCapabilities: input.requiredCapabilities,
        status: "pending",
        attempts: 0,
        idempotencyKey: input.idempotencyKey,
        createdAt: new Date().toISOString(),
        expiresAt: input.expiresAt,
      });

      const rows = asRows(await sql`
        INSERT INTO codexdock_invocations (
          invocation_id,
          owner_kind,
          owner_id,
          worker_id,
          type,
          prompt,
          payload,
          required_capabilities,
          status,
          result,
          error,
          attempts,
          idempotency_key,
          created_at,
          claimed_at,
          completed_at,
          expires_at
        )
        VALUES (
          ${invocation.invocationId},
          ${invocation.ownerKind},
          ${invocation.ownerId},
          ${invocation.workerId ?? null},
          ${invocation.type},
          ${invocation.prompt},
          ${JSON.stringify(invocation.payload)}::jsonb,
          ${JSON.stringify(invocation.requiredCapabilities)}::jsonb,
          ${invocation.status},
          ${jsonOrNull(invocation.result)}::jsonb,
          ${jsonOrNull(invocation.error)}::jsonb,
          ${invocation.attempts},
          ${invocation.idempotencyKey ?? null},
          ${invocation.createdAt},
          ${invocation.claimedAt ?? null},
          ${invocation.completedAt ?? null},
          ${invocation.expiresAt ?? null}
        )
        RETURNING *
      `);
      return invocationFromRow(rows[0]);
    },

    async getInvocation(invocationId, owner) {
      await ensureCodexDockSchema();
      const rows = asRows(await getSql()`
        SELECT * FROM codexdock_invocations
        WHERE invocation_id = ${invocationId}
          AND owner_kind = ${owner.ownerKind}
          AND owner_id = ${owner.ownerId}
        LIMIT 1
      `);
      return rows[0] ? invocationFromRow(rows[0]) : null;
    },

    async listInvocations(owner) {
      await ensureCodexDockSchema();
      const rows = asRows(await getSql()`
        SELECT * FROM codexdock_invocations
        WHERE owner_kind = ${owner.ownerKind}
          AND owner_id = ${owner.ownerId}
        ORDER BY created_at DESC
      `);
      return rows.map((row) => invocationFromRow(row));
    },

    async claimNextInvocation(input) {
      await ensureCodexDockSchema();
      await assertWorkerIsNotRevoked(input, input.workerId);
      const rows = asRows(await getSql()`
        WITH next_invocation AS (
          SELECT invocation_id
          FROM codexdock_invocations
          WHERE status = 'pending'
            AND owner_kind = ${input.ownerKind}
            AND owner_id = ${input.ownerId}
            AND ${JSON.stringify(input.capabilities)}::jsonb @> required_capabilities
          ORDER BY created_at ASC
          LIMIT 1
        )
        UPDATE codexdock_invocations
        SET status = 'running',
          worker_id = ${input.workerId},
          attempts = attempts + 1,
          claimed_at = NOW()
        WHERE invocation_id IN (SELECT invocation_id FROM next_invocation)
        RETURNING *
      `);
      return rows[0] ? invocationFromRow(rows[0]) : null;
    },

    async cancelInvocation(input) {
      await ensureCodexDockSchema();
      const rows = asRows(await getSql()`
        UPDATE codexdock_invocations
        SET status = 'cancelled',
          completed_at = NOW()
        WHERE invocation_id = ${input.invocationId}
          AND owner_kind = ${input.ownerKind}
          AND owner_id = ${input.ownerId}
          AND status IN ('pending', 'running')
        RETURNING *
      `);
      return rows[0] ? invocationFromRow(rows[0]) : null;
    },

    async completeInvocation(input) {
      await ensureCodexDockSchema();
      const rows = await updateClaimedInvocation(input, {
        status: "completed",
        result: input.result,
        error: null,
      });
      if (!rows[0]) throwCannotSubmit();
      return invocationFromRow(rows[0] as Row);
    },

    async failInvocation(input) {
      await ensureCodexDockSchema();
      const rows = await updateClaimedInvocation(input, {
        status: "failed",
        result: null,
        error: codexDockErrorSchema.parse(input.error),
      });
      if (!rows[0]) throwCannotSubmit();
      return invocationFromRow(rows[0] as Row);
    },

    async upsertWorker(input) {
      await ensureCodexDockSchema();
      const rows = asRows(await getSql()`
        INSERT INTO codexdock_workers (
          owner_kind,
          owner_id,
          worker_id,
          device_name,
          capabilities,
          status,
          last_seen_at,
          created_at,
          revoked_at
        )
        VALUES (
          ${input.ownerKind},
          ${input.ownerId},
          ${input.workerId},
          ${input.deviceName},
          ${JSON.stringify(input.capabilities)}::jsonb,
          ${input.status ?? "online"},
          NOW(),
          NOW(),
          ${input.status === "revoked" ? new Date().toISOString() : null}
        )
        ON CONFLICT (owner_kind, owner_id, worker_id)
        DO UPDATE SET
          device_name = EXCLUDED.device_name,
          capabilities = EXCLUDED.capabilities,
          status = CASE
            WHEN codexdock_workers.status = 'revoked' THEN 'revoked'
            ELSE EXCLUDED.status
          END,
          last_seen_at = NOW(),
          revoked_at = CASE
            WHEN codexdock_workers.status = 'revoked' THEN codexdock_workers.revoked_at
            WHEN EXCLUDED.status = 'revoked' THEN COALESCE(codexdock_workers.revoked_at, NOW())
            ELSE codexdock_workers.revoked_at
          END
        RETURNING *
      `);
      return workerFromRow(rows[0]);
    },

    async getWorker(workerId, owner) {
      await ensureCodexDockSchema();
      const rows = asRows(await getSql()`
        SELECT * FROM codexdock_workers
        WHERE owner_kind = ${owner.ownerKind}
          AND owner_id = ${owner.ownerId}
          AND worker_id = ${workerId}
        LIMIT 1
      `);
      return rows[0] ? workerFromRow(rows[0]) : null;
    },

    async listWorkers(owner) {
      await ensureCodexDockSchema();
      const rows = asRows(await getSql()`
        SELECT * FROM codexdock_workers
        WHERE owner_kind = ${owner.ownerKind}
          AND owner_id = ${owner.ownerId}
        ORDER BY last_seen_at DESC
      `);
      return rows.map((row) => workerFromRow(row));
    },
  };
}

export async function getPostgresPlaygroundState(owner: CodexDockOwner) {
  await ensureCodexDockSchema();
  const [status, invocationRows] = await Promise.all([
    getPostgresPlaygroundStatus(owner),
    getSql()`
      SELECT
        invocation_id,
        owner_kind,
        owner_id,
        worker_id,
        type,
        prompt,
        payload,
        required_capabilities,
        status,
        CASE
          WHEN result IS NULL THEN NULL
          WHEN pg_column_size(result) <= 32768 THEN result
          ELSE jsonb_build_object(
            'kind', 'large_result',
            'summary', 'Result is stored but hidden from the live list to reduce transfer.',
            'bytes', pg_column_size(result)
          )
        END AS result,
        error,
        attempts,
        idempotency_key,
        created_at,
        claimed_at,
        completed_at,
        expires_at
      FROM codexdock_invocations
      WHERE owner_kind = ${owner.ownerKind}
        AND owner_id = ${owner.ownerId}
        AND status <> 'cancelled'
      ORDER BY created_at DESC
      LIMIT 20
    `,
  ]);

  return {
    invocations: asRows(invocationRows).map((row) =>
      withInvocationProgress(invocationFromRow(row)),
    ),
    status,
  };
}

export async function getPostgresPlaygroundStatus(owner: CodexDockOwner) {
  await ensureCodexDockSchema();
  const [workerRows, countRows] = await Promise.all([
    getSql()`
      SELECT *
      FROM codexdock_workers
      WHERE owner_kind = ${owner.ownerKind}
        AND owner_id = ${owner.ownerId}
      ORDER BY last_seen_at DESC
    `,
    getSql()`
      SELECT status, count(*)::int AS count
      FROM codexdock_invocations
      WHERE owner_kind = ${owner.ownerKind}
        AND owner_id = ${owner.ownerId}
      GROUP BY status
    `,
  ]);

  return {
    counts: countsFromRows(asRows(countRows)),
    ok: true,
    owner,
    workers: asRows(workerRows).map((row) => workerFromRow(row)),
  } satisfies WorkerStatusResult;
}

export async function getPostgresPlaygroundActiveState(
  owner: CodexDockOwner,
  invocationIds: string[],
) {
  await ensureCodexDockSchema();
  const requestedIds = invocationIds.slice(0, 20);
  const invocationRows = requestedIds.length > 0
    ? await getSql()`
        WITH requested(invocation_id, ordinal) AS (
          SELECT value, ordinality
          FROM unnest(${requestedIds}::text[])
            WITH ORDINALITY AS requested(value, ordinality)
        )
        SELECT
          codexdock_invocations.invocation_id,
          owner_kind,
          owner_id,
          worker_id,
          type,
          prompt,
          payload,
          required_capabilities,
          status,
          CASE
            WHEN result IS NULL THEN NULL
            WHEN pg_column_size(result) <= 32768 THEN result
            ELSE jsonb_build_object(
              'kind', 'large_result',
              'summary', 'Result is stored but hidden from the live list to reduce transfer.',
              'bytes', pg_column_size(result)
            )
          END AS result,
          error,
          attempts,
          idempotency_key,
          created_at,
          claimed_at,
          completed_at,
          expires_at
        FROM codexdock_invocations
        JOIN requested
          ON requested.invocation_id = codexdock_invocations.invocation_id
        WHERE owner_kind = ${owner.ownerKind}
          AND owner_id = ${owner.ownerId}
        ORDER BY requested.ordinal
      `
    : [];

  return {
    invocations: asRows(invocationRows).map((row) =>
      withInvocationProgress(invocationFromRow(row)),
    ),
  };
}

async function createSchema() {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS codexdock_invocations (
      invocation_id TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      worker_id TEXT,
      type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      required_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL,
      result JSONB,
      error JSONB,
      attempts INTEGER NOT NULL DEFAULT 0,
      idempotency_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      claimed_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS codexdock_invocations_idempotency_idx
    ON codexdock_invocations (owner_kind, owner_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS codexdock_invocations_owner_status_idx
    ON codexdock_invocations (owner_kind, owner_id, status, created_at)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexdock_workers (
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      PRIMARY KEY (owner_kind, owner_id, worker_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexdock_pairing_codes (
      code_hash TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS codexdock_pairing_owner_idx
    ON codexdock_pairing_codes (owner_kind, owner_id, created_at DESC)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexdock_worker_tokens (
      token_hash TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS codexdock_worker_tokens_owner_idx
    ON codexdock_worker_tokens (owner_kind, owner_id, worker_id)
  `;
}

async function assertWorkerIsNotRevoked(owner: CodexDockOwner, workerId: string) {
  const rows = asRows(await getSql()`
    SELECT status FROM codexdock_workers
    WHERE owner_kind = ${owner.ownerKind}
      AND owner_id = ${owner.ownerId}
      AND worker_id = ${workerId}
    LIMIT 1
  `);
  if ((rows[0] as Row | undefined)?.status === "revoked") {
    throw new CodexDockHttpError(
      403,
      makeCodexDockError("WORKER_REVOKED", "Worker has been revoked."),
    );
  }
}

async function updateClaimedInvocation(
  input: CompleteInvocationInput | FailInvocationInput,
  update: { status: "completed" | "failed"; result: unknown; error: unknown },
) {
  return asRows(await getSql()`
    UPDATE codexdock_invocations
    SET status = ${update.status},
      result = ${jsonOrNull(update.result)}::jsonb,
      error = ${jsonOrNull(update.error)}::jsonb,
      completed_at = NOW()
    WHERE invocation_id = ${input.invocationId}
      AND owner_kind = ${input.ownerKind}
      AND owner_id = ${input.ownerId}
      AND worker_id = ${input.workerId}
      AND status = 'running'
    RETURNING *
  `);
}

function invocationFromRow(row: Row): InvocationRecord {
  return invocationRecordSchema.parse({
    invocationId: row.invocation_id,
    ownerKind: row.owner_kind,
    ownerId: row.owner_id,
    workerId: row.worker_id ?? undefined,
    type: row.type,
    prompt: row.prompt,
    payload: row.payload ?? {},
    requiredCapabilities: row.required_capabilities ?? [],
    status: row.status,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    attempts: row.attempts,
    idempotencyKey: row.idempotency_key ?? undefined,
    createdAt: isoString(row.created_at),
    claimedAt: optionalIsoString(row.claimed_at),
    completedAt: optionalIsoString(row.completed_at),
    expiresAt: optionalIsoString(row.expires_at),
  });
}

function workerFromRow(row: Row): WorkerRecord {
  return workerRecordSchema.parse({
    ownerKind: row.owner_kind,
    ownerId: row.owner_id,
    workerId: row.worker_id,
    deviceName: row.device_name,
    capabilities: row.capabilities ?? [],
    status: row.status,
    lastSeenAt: isoString(row.last_seen_at),
    createdAt: isoString(row.created_at),
    revokedAt: optionalIsoString(row.revoked_at),
  });
}

function countsFromRows(rows: Row[]): WorkerStatusResult["counts"] {
  const counts: WorkerStatusResult["counts"] = {
    cancelled: 0,
    completed: 0,
    expired: 0,
    failed: 0,
    pending: 0,
    running: 0,
  };

  for (const row of rows) {
    const status = row.status;
    if (typeof status === "string" && status in counts) {
      counts[status as keyof typeof counts] = Number(row.count ?? 0);
    }
  }

  return counts;
}

function databaseUrl() {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";
}

function shouldUseSsl(url: string) {
  const override = process.env.POSTGRES_SSL;
  if (override === "disable") return false;
  if (override === "require") return true;

  try {
    const hostname = new URL(url).hostname;
    return hostname !== "localhost" && hostname !== "127.0.0.1";
  } catch {
    return true;
  }
}

function jsonOrNull(value: unknown) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function isoString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function optionalIsoString(value: unknown) {
  return value ? isoString(value) : undefined;
}

function throwCannotSubmit(): never {
  throw new CodexDockHttpError(
    403,
    makeCodexDockError(
      "WORKER_AUTH_INVALID",
      "Worker cannot submit a result for an invocation it did not claim.",
    ),
  );
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}
