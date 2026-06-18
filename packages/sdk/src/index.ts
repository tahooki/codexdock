import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
export * from "./protocol.js";

import type {
  CodexDockError,
  CodexDockOwner,
  DiscoveryManifest,
  InvocationRecord,
  JsonObject,
  NormalizedInvokeRequest,
  NormalizedWorkerConnectRequest,
  WorkerNextResponse,
  WorkerRecord,
} from "./protocol.js";
import {
  codexDockErrorSchema,
  discoveryManifestSchema,
  generatedFileResultSchema,
  generatedImageResultSchema,
  generatedObjectResultSchema,
  generatedTextResultSchema,
  invocationRecordSchema,
  invokeRequestSchema,
  invokeTypes,
  makeCodexDockError,
  ownerSchema,
  workerConnectRequestSchema,
  workerRecordSchema,
  workerNextResponseSchema,
  workerResultRequestSchema,
} from "./protocol.js";

export interface CodexDockPersistence {
  createInvocation(input: CreateInvocationInput): Promise<InvocationRecord>;
  getInvocation(invocationId: string, owner: CodexDockOwner): Promise<InvocationRecord | null>;
  listInvocations?(owner: CodexDockOwner): Promise<InvocationRecord[]>;
  claimNextInvocation(input: ClaimNextInvocationInput): Promise<InvocationRecord | null>;
  cancelInvocation?(input: CancelInvocationInput): Promise<InvocationRecord | null>;
  completeInvocation(input: CompleteInvocationInput): Promise<InvocationRecord>;
  failInvocation(input: FailInvocationInput): Promise<InvocationRecord>;
  upsertWorker(input: UpsertWorkerInput): Promise<WorkerRecord>;
  getWorker(workerId: string, owner: CodexDockOwner): Promise<WorkerRecord | null>;
  listWorkers?(owner: CodexDockOwner): Promise<WorkerRecord[]>;
}

export type CreateInvocationInput = Omit<NormalizedInvokeRequest, "ownerKind" | "ownerId"> &
  CodexDockOwner & {
  invocationId?: string;
  expiresAt?: string;
};

export interface ClaimNextInvocationInput extends CodexDockOwner {
  workerId: string;
  capabilities: string[];
}

export interface CompleteInvocationInput extends CodexDockOwner {
  workerId: string;
  invocationId: string;
  result: unknown;
}

export interface CancelInvocationInput extends CodexDockOwner {
  invocationId: string;
}

export interface FailInvocationInput extends CodexDockOwner {
  workerId: string;
  invocationId: string;
  error: CodexDockError;
}

export type UpsertWorkerInput = Omit<
  NormalizedWorkerConnectRequest,
  "ownerKind" | "ownerId"
> &
  CodexDockOwner & {
  status?: WorkerRecord["status"];
};

export type WorkerAuthContext = CodexDockOwner;

export interface CodexDockOptions {
  persistence: CodexDockPersistence;
  workerToken?: string;
  allowInsecureWorkerAuth?: boolean;
  now?: () => Date;
  invocationTtlMs?: number;
  appName?: string;
  publicBaseUrl?: string;
  endpointBasePath?: string;
  defaultOwner?: CodexDockOwner;
  workerOwner?: CodexDockOwner;
  resolveOwner?: (request: Request) => CodexDockOwner | Promise<CodexDockOwner>;
  resolveWorkerAuth?: (request: Request) => CodexDockOwner | Promise<CodexDockOwner>;
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
  owner: CodexDockOwner;
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
  const defaultOwner = parseConfiguredOwner(
    options.defaultOwner ?? { ownerKind: "system", ownerId: "local-dev" },
    "defaultOwner",
  );
  const workerOwner = parseConfiguredOwner(options.workerOwner ?? defaultOwner, "workerOwner");
  const appName = options.appName ?? "CodexDock Host";
  const endpointBasePath = normalizeEndpointBasePath(
    options.endpointBasePath ?? "/api/codexdock",
  );

  if (!options.workerToken && !options.resolveWorkerAuth && !options.allowInsecureWorkerAuth) {
    throw new Error(
      "CodexDock workerToken or resolveWorkerAuth is required. Pass high-entropy worker auth, or set allowInsecureWorkerAuth only for local smoke tests.",
    );
  }

  async function authenticateWorker(request: Request): Promise<WorkerAuthContext> {
    if (options.resolveWorkerAuth) {
      const parsed = ownerSchema.safeParse(await options.resolveWorkerAuth(request));
      if (!parsed.success) {
        throw new CodexDockHttpError(
          401,
          makeCodexDockError("WORKER_AUTH_INVALID", "Unable to resolve CodexDock worker owner."),
        );
      }
      return parsed.data;
    }

    if (!options.workerToken && options.allowInsecureWorkerAuth) return workerOwner;

    const auth = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${options.workerToken}`;

    if (!safeEqual(auth, expected)) {
      throw new CodexDockHttpError(
        401,
        makeCodexDockError("WORKER_AUTH_INVALID", "Invalid worker token."),
      );
    }

    return workerOwner;
  }

  async function resolveRequestOwner(request: Request): Promise<CodexDockOwner> {
    if (!options.resolveOwner) return defaultOwner;

    const parsed = ownerSchema.safeParse(await options.resolveOwner(request));
    if (!parsed.success) {
      throw new CodexDockHttpError(
        401,
        makeCodexDockError("WORKER_AUTH_INVALID", "Unable to resolve CodexDock owner."),
      );
    }

    return parsed.data;
  }

  async function invoke(input: unknown, ownerOverride?: CodexDockOwner): Promise<InvokeAccepted> {
    const parsed = invokeRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new CodexDockHttpError(
        400,
        makeCodexDockError("INVALID_PAYLOAD", "Invalid invoke payload.", {
          details: { issues: parsed.error.issues as unknown as JsonObject },
        }),
      );
    }

    const owner = resolveInvocationOwner(parsed.data, ownerOverride);
    const expiresAt = new Date(now().getTime() + invocationTtlMs).toISOString();
    const record = await options.persistence.createInvocation({
      ...parsed.data,
      ...owner,
      expiresAt,
    });

    return {
      invocationId: record.invocationId,
      status: "pending",
      statusUrl: `${endpointBasePath}/invocations/${record.invocationId}`,
    };
  }

  async function getInvocation(
    invocationId: string,
    ownerOverride?: CodexDockOwner,
  ): Promise<InvocationRecord | null> {
    return options.persistence.getInvocation(invocationId, ownerOverride ?? defaultOwner);
  }

  async function cancelInvocation(
    invocationId: string,
    ownerOverride?: CodexDockOwner,
  ): Promise<InvocationRecord | null> {
    if (!options.persistence.cancelInvocation) {
      throw new CodexDockHttpError(
        501,
        makeCodexDockError(
          "INTERNAL_ERROR",
          "This CodexDock persistence adapter does not support cancelling invocations.",
        ),
      );
    }

    return options.persistence.cancelInvocation({
      ...(ownerOverride ?? defaultOwner),
      invocationId,
    });
  }

  async function workerConnect(
    input: unknown,
    ownerOverride?: CodexDockOwner,
  ): Promise<WorkerConnectResult> {
    const parsed = workerConnectRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new CodexDockHttpError(
        400,
        makeCodexDockError("INVALID_PAYLOAD", "Invalid worker connect payload."),
      );
    }

    const owner = resolveWorkerOwner(parsed.data, ownerOverride);
    const existingWorker = await options.persistence.getWorker(parsed.data.workerId, owner);
    if (existingWorker) assertWorkerIsActive(existingWorker);

    const worker = await options.persistence.upsertWorker({
      ...parsed.data,
      ...owner,
      status: "online",
    });

    assertWorkerIsActive(worker);

    return {
      ok: true,
      worker,
      polling: {
        emptyMinMs: 2_000,
        emptyMaxMs: 30_000,
      },
    };
  }

  async function workerNext(
    workerId: string,
    ownerOverride?: CodexDockOwner,
  ): Promise<WorkerNextResponse | null> {
    const owner = ownerOverride ?? workerOwner;
    const worker = await options.persistence.getWorker(workerId, owner);
    if (!worker) return null;

    if (worker.status === "revoked") {
      throw new CodexDockHttpError(
        403,
        makeCodexDockError("WORKER_REVOKED", "Worker has been revoked."),
      );
    }

    const invocation = await options.persistence.claimNextInvocation({
      ...owner,
      workerId,
      capabilities: worker.capabilities,
    });
    if (!invocation) return null;

    return workerNextResponseSchema.parse({
      invocationId: invocation.invocationId,
      ownerKind: invocation.ownerKind,
      ownerId: invocation.ownerId,
      type: invocation.type,
      prompt: invocation.prompt,
      parameters: invocation.payload,
      payload: invocation.payload,
      requiredCapabilities: invocation.requiredCapabilities,
    });
  }

  async function workerResult(
    input: unknown,
    ownerOverride?: CodexDockOwner,
  ): Promise<InvocationRecord> {
    const parsed = workerResultRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new CodexDockHttpError(
        400,
        makeCodexDockError("INVALID_PAYLOAD", "Invalid worker result payload."),
      );
    }

    const owner = ownerOverride ?? workerOwner;
    const worker = await getWorkerForResult(parsed.data.workerId, owner);
    assertWorkerIsActive(worker);
    const invocation = await getInvocationForResult(parsed.data.invocationId, owner);
    assertWorkerCanSubmit(invocation, parsed.data.workerId);

    if (parsed.data.ok) {
      const result = validateCompletedResult(invocation, parsed.data.result ?? null);

      return options.persistence.completeInvocation({
        ...owner,
        workerId: parsed.data.workerId,
        invocationId: parsed.data.invocationId,
        result,
      });
    }

    return options.persistence.failInvocation({
      ...owner,
      workerId: parsed.data.workerId,
      invocationId: parsed.data.invocationId,
      error:
        parsed.data.error ??
        makeCodexDockError("CODEX_RUN_FAILED", "Worker failed without details."),
    });
  }

  async function getWorkerStatus(ownerOverride?: CodexDockOwner): Promise<WorkerStatusResult> {
    const owner = ownerOverride ?? defaultOwner;
    const workers = options.persistence.listWorkers
      ? await options.persistence.listWorkers(owner)
      : [];
    const invocations = options.persistence.listInvocations
      ? await options.persistence.listInvocations(owner)
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

    return { ok: true, owner, workers, counts };
  }

  function discovery(request?: Request): DiscoveryManifest {
    const origin = options.publicBaseUrl ?? (request ? new URL(request.url).origin : "http://localhost");
    const endpoint = (path: string) =>
      new URL(`${endpointBasePath}${path}`, origin).toString();

    return discoveryManifestSchema.parse({
      appName,
      endpoints: {
        discovery: endpoint("/discovery"),
        invoke: endpoint("/invoke"),
        getInvocation: endpoint("/invocations"),
        workerStatus: endpoint("/worker/status"),
        workerConnect: endpoint("/worker/connect"),
        workerNext: endpoint("/worker/next"),
        workerResult: endpoint("/worker/result"),
      },
      capabilities: {
        generationTypes: Array.from(invokeTypes),
        artifactUpload: ["inline"],
      },
    });
  }

  async function getInvocationForResult(
    invocationId: string,
    owner: CodexDockOwner,
  ): Promise<InvocationRecord> {
    const invocation = await options.persistence.getInvocation(invocationId, owner);
    if (!invocation) {
      throw new CodexDockHttpError(
        404,
        makeCodexDockError("INVALID_PAYLOAD", "Invocation not found."),
      );
    }
    return invocation;
  }

  async function getWorkerForResult(
    workerId: string,
    owner: CodexDockOwner,
  ): Promise<WorkerRecord> {
    const worker = await options.persistence.getWorker(workerId, owner);
    if (!worker) {
      throw new CodexDockHttpError(
        403,
        makeCodexDockError(
          "WORKER_AUTH_INVALID",
          "Worker cannot submit a result because it is not connected for this owner.",
        ),
      );
    }
    return worker;
  }

  function assertWorkerIsActive(worker: WorkerRecord): void {
    if (worker.status === "revoked") {
      throw new CodexDockHttpError(
        403,
        makeCodexDockError("WORKER_REVOKED", "Worker has been revoked."),
      );
    }
  }

  function resolveInvocationOwner(
    input: NormalizedInvokeRequest,
    ownerOverride?: CodexDockOwner,
  ): CodexDockOwner {
    if (ownerOverride) return ownerOverride;
    return ownerFromOptionalFields(input) ?? defaultOwner;
  }

  function resolveWorkerOwner(
    input: NormalizedWorkerConnectRequest,
    ownerOverride?: CodexDockOwner,
  ): CodexDockOwner {
    if (ownerOverride) return ownerOverride;
    return ownerFromOptionalFields(input) ?? workerOwner;
  }

  function ownerFromOptionalFields(input: {
    ownerKind?: CodexDockOwner["ownerKind"];
    ownerId?: string;
  }): CodexDockOwner | null {
    if (!input.ownerKind && !input.ownerId) return null;
    if (input.ownerKind && input.ownerId) {
      return parseHttpOwner({ ownerKind: input.ownerKind, ownerId: input.ownerId });
    }

    throw new CodexDockHttpError(
      400,
      makeCodexDockError(
        "INVALID_PAYLOAD",
        "CodexDock ownerKind and ownerId must be provided together.",
      ),
    );
  }

  function assertWorkerCanSubmit(invocation: InvocationRecord, workerId: string): void {
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

  function validateCompletedResult(invocation: InvocationRecord, result: unknown): unknown {
    if (invocation.type === "generate_text") {
      const parsed = generatedTextResultSchema.safeParse(result);
      if (!parsed.success) {
        throw invalidWorkerResult("generate_text", parsed.error.issues);
      }
      return attachInvocationParameters(parsed.data, invocation.payload);
    }

    if (invocation.type === "generate_object") {
      const parsed = generatedObjectResultSchema.safeParse(result);
      if (!parsed.success) {
        throw invalidWorkerResult("generate_object", parsed.error.issues);
      }
      return attachInvocationParameters(parsed.data, invocation.payload);
    }

    if (invocation.type === "generate_file") {
      const parsed = generatedFileResultSchema.safeParse(result);
      if (!parsed.success) {
        throw invalidWorkerResult("generate_file", parsed.error.issues);
      }
      return attachInvocationParameters(parsed.data, invocation.payload);
    }

    if (invocation.type === "generate_image") {
      const parsed = generatedImageResultSchema.safeParse(result);
      if (!parsed.success) {
        throw invalidWorkerResult("generate_image", parsed.error.issues);
      }
      return attachInvocationParameters(parsed.data, invocation.payload);
    }

    return attachInvocationParameters(result, invocation.payload);
  }

  function invalidWorkerResult(type: InvocationRecord["type"], issues: unknown): CodexDockHttpError {
    return new CodexDockHttpError(
      400,
      makeCodexDockError("INVALID_PAYLOAD", `Invalid ${type} result payload.`, {
        details: { issues: issues as JsonObject },
      }),
    );
  }

  function attachInvocationParameters(result: unknown, parameters: JsonObject): unknown {
    if (result && typeof result === "object" && !Array.isArray(result)) {
      return {
        ...(result as Record<string, unknown>),
        parameters,
      };
    }

    return {
      value: result,
      parameters,
    };
  }

  const handlers = createRouteHandlers({
    authenticateWorker,
    resolveRequestOwner,
    discovery,
    invoke,
    getInvocation,
    cancelInvocation,
    workerConnect,
    workerNext,
    workerResult,
    getWorkerStatus,
  });

  return {
    invoke,
    getInvocation,
    cancelInvocation,
    getWorkerStatus,
    workerConnect,
    workerNext,
    workerResult,
    discovery,
    handlers,
  };
}

export interface RouteHandlerDeps {
  authenticateWorker(request: Request): WorkerAuthContext | Promise<WorkerAuthContext>;
  resolveRequestOwner(request: Request): Promise<CodexDockOwner>;
  discovery(request?: Request): DiscoveryManifest;
  invoke(input: unknown, owner: CodexDockOwner): Promise<InvokeAccepted>;
  getInvocation(invocationId: string, owner: CodexDockOwner): Promise<InvocationRecord | null>;
  cancelInvocation(invocationId: string, owner: CodexDockOwner): Promise<InvocationRecord | null>;
  workerConnect(input: unknown, owner: CodexDockOwner): Promise<WorkerConnectResult>;
  workerNext(workerId: string, owner: CodexDockOwner): Promise<WorkerNextResponse | null>;
  workerResult(input: unknown, owner: CodexDockOwner): Promise<InvocationRecord>;
  getWorkerStatus(owner: CodexDockOwner): Promise<WorkerStatusResult>;
}

export function createRouteHandlers(deps: RouteHandlerDeps) {
  return {
    discovery: async (request: Request) =>
      withHttpErrors(async () => jsonResponse(deps.discovery(request))),

    invoke: async (request: Request) =>
      withHttpErrors(async () => {
        const owner = await deps.resolveRequestOwner(request);
        return jsonResponse(await deps.invoke(await readJson(request), owner), { status: 202 });
      }),

    getInvocation: async (
      request: Request,
      context: { params: Promise<{ invocationId: string }> } | { params: { invocationId: string } },
    ) => withHttpErrors(async () => {
      const owner = await deps.resolveRequestOwner(request);
      const params = await context.params;
      const invocation = await deps.getInvocation(params.invocationId, owner);
      if (!invocation) {
        return jsonResponse(
          { ok: false, error: makeCodexDockError("INVALID_PAYLOAD", "Invocation not found.") },
          { status: 404 },
        );
      }
      return jsonResponse({ ok: true, invocation });
    }),

    cancelInvocation: async (
      request: Request,
      context: { params: Promise<{ invocationId: string }> } | { params: { invocationId: string } },
    ) => withHttpErrors(async () => {
      const owner = await deps.resolveRequestOwner(request);
      const params = await context.params;
      const invocation = await deps.cancelInvocation(params.invocationId, owner);
      if (!invocation) {
        return jsonResponse(
          {
            ok: false,
            error: makeCodexDockError(
              "INVALID_PAYLOAD",
              "Invocation not found or cannot be cancelled.",
            ),
          },
          { status: 404 },
        );
      }
      return jsonResponse({ ok: true, invocation });
    }),

    workerStatus: async (request: Request) => withHttpErrors(async () => {
      const auth = await deps.authenticateWorker(request);
      return jsonResponse(await deps.getWorkerStatus(auth));
    }),

    workerConnect: async (request: Request) => withHttpErrors(async () => {
      const auth = await deps.authenticateWorker(request);
      return jsonResponse(await deps.workerConnect(await readJson(request), auth));
    }),

    workerNext: async (request: Request) => withHttpErrors(async () => {
      const auth = await deps.authenticateWorker(request);
      const input = await readJson(request);
      const workerId = getStringField(input, "workerId");
      const next = await deps.workerNext(workerId, auth);
      if (!next) return new Response(null, { status: 204 });
      return jsonResponse(next);
    }),

    workerResult: async (request: Request) => withHttpErrors(async () => {
      const auth = await deps.authenticateWorker(request);
      return jsonResponse({
        ok: true,
        invocation: await deps.workerResult(await readJson(request), auth),
      });
    }),
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

  function assertClaimedBy(
    invocation: InvocationRecord,
    workerId: string,
    owner: CodexDockOwner,
  ): void {
    if (!sameOwner(invocation, owner)) {
      throw new CodexDockHttpError(
        404,
        makeCodexDockError("INVALID_PAYLOAD", "Invocation not found."),
      );
    }

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

  function getOwnedInvocationOrThrow(
    invocationId: string,
    owner: CodexDockOwner,
  ): InvocationRecord {
    const existing = invocations.get(invocationId);
    if (!existing || !sameOwner(existing, owner)) {
      throw new CodexDockHttpError(
        404,
        makeCodexDockError("INVALID_PAYLOAD", "Invocation not found."),
      );
    }
    return existing;
  }

  return {
    async createInvocation(input) {
      if (input.idempotencyKey) {
        const existingId = idempotencyIndex.get(idempotencyKeyFor(input));
        if (existingId) {
          const existing = invocations.get(existingId);
          if (existing && sameOwner(existing, input)) return existing;
        }
      }

      const invocation: InvocationRecord = invocationRecordSchema.parse({
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
        createdAt: stamp(),
        expiresAt: input.expiresAt,
      });

      invocations.set(invocation.invocationId, invocation);
      if (input.idempotencyKey) {
        idempotencyIndex.set(idempotencyKeyFor(input), invocation.invocationId);
      }
      return invocation;
    },

    async getInvocation(invocationId, owner) {
      const invocation = invocations.get(invocationId) ?? null;
      if (!invocation || !sameOwner(invocation, owner)) return null;
      return invocation;
    },

    async listInvocations(owner) {
      return [...invocations.values()]
        .filter((invocation) => sameOwner(invocation, owner))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async claimNextInvocation(input) {
      const worker = workers.get(workerKey(input, input.workerId));
      if (worker?.status === "revoked") {
        throw new CodexDockHttpError(
          403,
          makeCodexDockError("WORKER_REVOKED", "Worker has been revoked."),
        );
      }

      const pending = [...invocations.values()]
        .filter(
          (invocation) =>
            invocation.status === "pending" &&
            sameOwner(invocation, input) &&
            supportsRequiredCapabilities(input.capabilities, invocation.requiredCapabilities),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

      if (!pending) return null;

      const nextRecord = invocationRecordSchema.parse({
        ...pending,
        status: "running",
        workerId: input.workerId,
        attempts: (pending.attempts ?? 0) + 1,
        claimedAt: stamp(),
      });
      invocations.set(nextRecord.invocationId, nextRecord);
      return nextRecord;
    },

    async cancelInvocation(input) {
      const existing = invocations.get(input.invocationId);
      if (
        !existing ||
        !sameOwner(existing, input) ||
        (existing.status !== "pending" && existing.status !== "running")
      ) {
        return null;
      }

      const updated = invocationRecordSchema.parse({
        ...existing,
        status: "cancelled",
        completedAt: stamp(),
      });
      invocations.set(updated.invocationId, updated);
      return updated;
    },

    async completeInvocation(input) {
      const existing = getOwnedInvocationOrThrow(input.invocationId, input);
      assertClaimedBy(existing, input.workerId, input);

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
      const existing = getOwnedInvocationOrThrow(input.invocationId, input);
      assertClaimedBy(existing, input.workerId, input);

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
      const key = workerKey(input, input.workerId);
      const existing = workers.get(key);
      const timestamp = stamp();
      const status =
        existing?.status === "revoked"
          ? "revoked"
          : input.status ?? existing?.status ?? "online";
      const worker = workerRecordSchema.parse({
        workerId: input.workerId,
        ownerKind: input.ownerKind,
        ownerId: input.ownerId,
        deviceName: input.deviceName,
        capabilities: input.capabilities,
        status,
        lastSeenAt: timestamp,
        createdAt: existing?.createdAt ?? timestamp,
        revokedAt: status === "revoked" ? existing?.revokedAt ?? timestamp : existing?.revokedAt,
      });
      workers.set(key, worker);
      return worker;
    },

    async getWorker(workerId, owner) {
      return workers.get(workerKey(owner, workerId)) ?? null;
    },

    async listWorkers(owner) {
      return [...workers.values()]
        .filter((worker) => sameOwner(worker, owner))
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
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

async function withHttpErrors(callback: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof CodexDockHttpError) {
      return jsonResponse({ ok: false, error: error.error }, { status: error.status });
    }
    throw error;
  }
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

function parseConfiguredOwner(input: unknown, label: string): CodexDockOwner {
  const parsed = ownerSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`${label} must include ownerKind and ownerId.`);
  }
  return parsed.data;
}

function parseHttpOwner(input: unknown): CodexDockOwner {
  const parsed = ownerSchema.safeParse(input);
  if (!parsed.success) {
    throw new CodexDockHttpError(
      400,
      makeCodexDockError("INVALID_PAYLOAD", "Invalid CodexDock owner."),
    );
  }
  return parsed.data;
}

function sameOwner(left: CodexDockOwner, right: CodexDockOwner): boolean {
  return left.ownerKind === right.ownerKind && left.ownerId === right.ownerId;
}

function ownerKey(owner: CodexDockOwner): string {
  return `${owner.ownerKind}:${owner.ownerId}`;
}

function workerKey(owner: CodexDockOwner, workerId: string): string {
  return `${ownerKey(owner)}:${workerId}`;
}

function idempotencyKeyFor(input: Pick<CreateInvocationInput, "ownerKind" | "ownerId" | "idempotencyKey">): string {
  return `${ownerKey(input)}:${input.idempotencyKey}`;
}

function supportsRequiredCapabilities(workerCapabilities: string[], requiredCapabilities: string[]): boolean {
  if (requiredCapabilities.length === 0) return true;
  const supported = new Set(workerCapabilities);
  return requiredCapabilities.every((capability) => supported.has(capability));
}

function normalizeEndpointBasePath(basePath: string): string {
  const trimmed = basePath.trim();
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, Math.max(1, withLeadingSlash.length - 1))
    : withLeadingSlash;
}

function safeEqual(a: string, b: string): boolean {
  const aHash = createHash("sha256").update(a).digest();
  const bHash = createHash("sha256").update(b).digest();
  return timingSafeEqual(aHash, bHash);
}
