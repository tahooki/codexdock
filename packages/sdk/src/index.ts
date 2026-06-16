import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  CodexDockError,
  InvocationRecord,
  JsonObject,
  NormalizedInvokeRequest,
  NormalizedWorkerConnectRequest,
  WorkerNextResponse,
  WorkerRecord,
  WorkerResultRequest,
} from "@codexdock/protocol";
import {
  codexDockErrorSchema,
  invocationRecordSchema,
  invokeRequestSchema,
  makeCodexDockError,
  workerConnectRequestSchema,
  workerNextResponseSchema,
  workerResultRequestSchema,
} from "@codexdock/protocol";

export interface CodexDockPersistence {
  createInvocation(input: CreateInvocationInput): Promise<InvocationRecord>;
  getInvocation(invocationId: string): Promise<InvocationRecord | null>;
  listInvocations?(): Promise<InvocationRecord[]>;
  claimNextInvocation(workerId: string): Promise<InvocationRecord | null>;
  completeInvocation(input: CompleteInvocationInput): Promise<InvocationRecord>;
  failInvocation(input: FailInvocationInput): Promise<InvocationRecord>;
  upsertWorker(input: UpsertWorkerInput): Promise<WorkerRecord>;
  getWorker(workerId: string): Promise<WorkerRecord | null>;
  listWorkers?(): Promise<WorkerRecord[]>;
}

export interface CreateInvocationInput extends NormalizedInvokeRequest {
  invocationId?: string;
  expiresAt?: string;
}

export interface CompleteInvocationInput {
  workerId: string;
  invocationId: string;
  result: unknown;
}

export interface FailInvocationInput {
  workerId: string;
  invocationId: string;
  error: CodexDockError;
}

export interface UpsertWorkerInput extends NormalizedWorkerConnectRequest {
  status?: WorkerRecord["status"];
}

export interface CodexDockOptions {
  persistence: CodexDockPersistence;
  workerToken?: string;
  now?: () => Date;
  invocationTtlMs?: number;
}

export interface InvokeAccepted {
  invocationId: string;
  status: "pending";
  statusUrl: string;
}

export interface WorkerConnectResult {
  ok: true;
  worker: WorkerRecord;
  polling: {
    emptyMinMs: number;
    emptyMaxMs: number;
  };
}

export interface WorkerStatusResult {
  ok: true;
  workers: WorkerRecord[];
  counts: Record<InvocationRecord["status"], number>;
}

export class CodexDockHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: CodexDockError,
  ) {
    super(error.message);
  }
}

export function createCodexDock(options: CodexDockOptions) {
  const now = options.now ?? (() => new Date());
  const invocationTtlMs = options.invocationTtlMs ?? 10 * 60 * 1000;

  function requireWorkerToken(request: Request): void {
    if (!options.workerToken) return;

    const auth = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${options.workerToken}`;

    if (!safeEqual(auth, expected)) {
      throw new CodexDockHttpError(
        401,
        makeCodexDockError("WORKER_AUTH_INVALID", "Invalid worker token."),
      );
    }
  }

  async function invoke(input: unknown): Promise<InvokeAccepted> {
    const parsed = invokeRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new CodexDockHttpError(
        400,
        makeCodexDockError("INVALID_PAYLOAD", "Invalid invoke payload.", {
          details: { issues: parsed.error.issues as unknown as JsonObject },
        }),
      );
    }

    const expiresAt = new Date(now().getTime() + invocationTtlMs).toISOString();
    const record = await options.persistence.createInvocation({
      ...parsed.data,
      expiresAt,
    });

    return {
      invocationId: record.invocationId,
      status: "pending",
      statusUrl: `/api/codexdock/invocations/${record.invocationId}`,
    };
  }

  async function getInvocation(invocationId: string): Promise<InvocationRecord | null> {
    return options.persistence.getInvocation(invocationId);
  }

  async function workerConnect(input: unknown): Promise<WorkerConnectResult> {
    const parsed = workerConnectRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new CodexDockHttpError(
        400,
        makeCodexDockError("INVALID_PAYLOAD", "Invalid worker connect payload."),
      );
    }

    const worker = await options.persistence.upsertWorker({
      ...parsed.data,
      status: "online",
    });

    return {
      ok: true,
      worker,
      polling: {
        emptyMinMs: 2_000,
        emptyMaxMs: 30_000,
      },
    };
  }

  async function workerNext(workerId: string): Promise<WorkerNextResponse | null> {
    const worker = await options.persistence.getWorker(workerId);
    if (worker?.status === "revoked") {
      throw new CodexDockHttpError(
        403,
        makeCodexDockError("WORKER_REVOKED", "Worker has been revoked."),
      );
    }

    const invocation = await options.persistence.claimNextInvocation(workerId);
    if (!invocation) return null;

    return workerNextResponseSchema.parse({
      invocationId: invocation.invocationId,
      type: invocation.type,
      prompt: invocation.prompt,
      payload: invocation.payload,
    });
  }

  async function workerResult(input: unknown): Promise<InvocationRecord> {
    const parsed = workerResultRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new CodexDockHttpError(
        400,
        makeCodexDockError("INVALID_PAYLOAD", "Invalid worker result payload."),
      );
    }

    if (parsed.data.ok) {
      return options.persistence.completeInvocation({
        workerId: parsed.data.workerId,
        invocationId: parsed.data.invocationId,
        result: parsed.data.result ?? null,
      });
    }

    return options.persistence.failInvocation({
      workerId: parsed.data.workerId,
      invocationId: parsed.data.invocationId,
      error:
        parsed.data.error ??
        makeCodexDockError("CODEX_RUN_FAILED", "Worker failed without details."),
    });
  }

  async function getWorkerStatus(): Promise<WorkerStatusResult> {
    const workers = options.persistence.listWorkers
      ? await options.persistence.listWorkers()
      : [];
    const invocations = options.persistence.listInvocations
      ? await options.persistence.listInvocations()
      : [];

    const counts: WorkerStatusResult["counts"] = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      expired: 0,
      cancelled: 0,
    };

    for (const invocation of invocations) {
      counts[invocation.status] += 1;
    }

    return { ok: true, workers, counts };
  }

  const handlers = createRouteHandlers({
    requireWorkerToken,
    invoke,
    getInvocation,
    workerConnect,
    workerNext,
    workerResult,
    getWorkerStatus,
  });

  return {
    invoke,
    getInvocation,
    getWorkerStatus,
    workerConnect,
    workerNext,
    workerResult,
    handlers,
  };
}

export interface RouteHandlerDeps {
  requireWorkerToken(request: Request): void;
  invoke(input: unknown): Promise<InvokeAccepted>;
  getInvocation(invocationId: string): Promise<InvocationRecord | null>;
  workerConnect(input: unknown): Promise<WorkerConnectResult>;
  workerNext(workerId: string): Promise<WorkerNextResponse | null>;
  workerResult(input: unknown): Promise<InvocationRecord>;
  getWorkerStatus(): Promise<WorkerStatusResult>;
}

export function createRouteHandlers(deps: RouteHandlerDeps) {
  return {
    invoke: async (request: Request) =>
      jsonResponse(await deps.invoke(await readJson(request)), { status: 202 }),

    getInvocation: async (
      _request: Request,
      context: { params: Promise<{ invocationId: string }> } | { params: { invocationId: string } },
    ) => {
      const params = await context.params;
      const invocation = await deps.getInvocation(params.invocationId);
      if (!invocation) {
        return jsonResponse(
          { ok: false, error: makeCodexDockError("INVALID_PAYLOAD", "Invocation not found.") },
          { status: 404 },
        );
      }
      return jsonResponse({ ok: true, invocation });
    },

    workerStatus: async () => jsonResponse(await deps.getWorkerStatus()),

    workerConnect: async (request: Request) => {
      deps.requireWorkerToken(request);
      return jsonResponse(await deps.workerConnect(await readJson(request)));
    },

    workerNext: async (request: Request) => {
      deps.requireWorkerToken(request);
      const input = await readJson(request);
      const workerId = getStringField(input, "workerId");
      const next = await deps.workerNext(workerId);
      if (!next) return new Response(null, { status: 204 });
      return jsonResponse(next);
    },

    workerResult: async (request: Request) => {
      deps.requireWorkerToken(request);
      return jsonResponse({ ok: true, invocation: await deps.workerResult(await readJson(request)) });
    },
  };
}

export function createMemoryPersistence(options: { now?: () => Date } = {}): CodexDockPersistence {
  const now = options.now ?? (() => new Date());
  const invocations = new Map<string, InvocationRecord>();
  const workers = new Map<string, WorkerRecord>();
  const idempotencyIndex = new Map<string, string>();

  function stamp() {
    return now().toISOString();
  }

  function assertClaimedBy(invocation: InvocationRecord, workerId: string): void {
    if (invocation.workerId !== workerId || invocation.status !== "running") {
      throw new CodexDockHttpError(
        403,
        makeCodexDockError(
          "WORKER_AUTH_INVALID",
          "Worker cannot submit a result for an invocation it did not claim.",
        ),
      );
    }
  }

  return {
    async createInvocation(input) {
      if (input.idempotencyKey) {
        const existingId = idempotencyIndex.get(input.idempotencyKey);
        if (existingId) {
          const existing = invocations.get(existingId);
          if (existing) return existing;
        }
      }

      const invocation: InvocationRecord = invocationRecordSchema.parse({
        invocationId: input.invocationId ?? `inv_${randomUUID()}`,
        type: input.type,
        prompt: input.prompt,
        payload: input.payload,
        status: "pending",
        attempts: 0,
        idempotencyKey: input.idempotencyKey,
        createdAt: stamp(),
        expiresAt: input.expiresAt,
      });

      invocations.set(invocation.invocationId, invocation);
      if (input.idempotencyKey) {
        idempotencyIndex.set(input.idempotencyKey, invocation.invocationId);
      }
      return invocation;
    },

    async getInvocation(invocationId) {
      return invocations.get(invocationId) ?? null;
    },

    async listInvocations() {
      return [...invocations.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async claimNextInvocation(workerId) {
      const worker = workers.get(workerId);
      if (worker?.status === "revoked") {
        throw new CodexDockHttpError(
          403,
          makeCodexDockError("WORKER_REVOKED", "Worker has been revoked."),
        );
      }

      const pending = [...invocations.values()]
        .filter((invocation) => invocation.status === "pending")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

      if (!pending) return null;

      const nextRecord = invocationRecordSchema.parse({
        ...pending,
        status: "running",
        workerId,
        attempts: (pending.attempts ?? 0) + 1,
        claimedAt: stamp(),
      });
      invocations.set(nextRecord.invocationId, nextRecord);
      return nextRecord;
    },

    async completeInvocation(input) {
      const existing = invocations.get(input.invocationId);
      if (!existing) {
        throw new CodexDockHttpError(
          404,
          makeCodexDockError("INVALID_PAYLOAD", "Invocation not found."),
        );
      }
      assertClaimedBy(existing, input.workerId);

      const updated = invocationRecordSchema.parse({
        ...existing,
        status: "completed",
        result: input.result,
        error: undefined,
        completedAt: stamp(),
      });
      invocations.set(updated.invocationId, updated);
      return updated;
    },

    async failInvocation(input) {
      const existing = invocations.get(input.invocationId);
      if (!existing) {
        throw new CodexDockHttpError(
          404,
          makeCodexDockError("INVALID_PAYLOAD", "Invocation not found."),
        );
      }
      assertClaimedBy(existing, input.workerId);

      const updated = invocationRecordSchema.parse({
        ...existing,
        status: "failed",
        result: undefined,
        error: codexDockErrorSchema.parse(input.error),
        completedAt: stamp(),
      });
      invocations.set(updated.invocationId, updated);
      return updated;
    },

    async upsertWorker(input) {
      const existing = workers.get(input.workerId);
      const worker: WorkerRecord = {
        workerId: input.workerId,
        deviceName: input.deviceName,
        capabilities: input.capabilities,
        status: input.status ?? existing?.status ?? "online",
        lastSeenAt: stamp(),
        createdAt: existing?.createdAt ?? stamp(),
        revokedAt: existing?.revokedAt,
      };
      workers.set(worker.workerId, worker);
      return worker;
    },

    async getWorker(workerId) {
      return workers.get(workerId) ?? null;
    },

    async listWorkers() {
      return [...workers.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    },
  };
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function jsonResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });
}

function getStringField(input: unknown, field: string): string {
  if (!input || typeof input !== "object" || !(field in input)) {
    throw new CodexDockHttpError(
      400,
      makeCodexDockError("INVALID_PAYLOAD", `Missing ${field}.`),
    );
  }
  const value = (input as Record<string, unknown>)[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new CodexDockHttpError(
      400,
      makeCodexDockError("INVALID_PAYLOAD", `Invalid ${field}.`),
    );
  }
  return value;
}

function safeEqual(a: string, b: string): boolean {
  const aHash = createHash("sha256").update(a).digest();
  const bHash = createHash("sha256").update(b).digest();
  return timingSafeEqual(aHash, bHash);
}
