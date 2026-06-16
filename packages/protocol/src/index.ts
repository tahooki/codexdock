import { z } from "zod";

export const CODEXDOCK_PROTOCOL_VERSION = "0.1.0";

export const invocationStatuses = [
  "pending",
  "running",
  "completed",
  "failed",
  "expired",
  "cancelled",
] as const;

export const workerStatuses = ["online", "offline", "revoked"] as const;

export const invokeTypes = [
  "generate_data",
  "generate_file",
  "generate_image_plan",
] as const;

export const codexDockErrorCodes = [
  "WORKER_OFFLINE",
  "UNSUPPORTED_INVOKE_TYPE",
  "INVALID_PAYLOAD",
  "INVOCATION_TIMEOUT",
  "WORKER_AUTH_INVALID",
  "WORKER_REVOKED",
  "CODEX_NOT_AVAILABLE",
  "CODEX_AUTH_REQUIRED",
  "CODEX_RUN_FAILED",
  "INTERNAL_ERROR",
] as const;

export type InvocationStatus = (typeof invocationStatuses)[number];
export type WorkerStatus = (typeof workerStatuses)[number];
export type InvokeType = (typeof invokeTypes)[number];
export type CodexDockErrorCode = (typeof codexDockErrorCodes)[number];

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = Record<string, JsonValue>;

export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export const codexDockErrorSchema = z.object({
  code: z.enum(codexDockErrorCodes),
  message: z.string().min(1),
  retryable: z.boolean(),
  details: jsonObjectSchema.optional(),
});

export type CodexDockError = z.infer<typeof codexDockErrorSchema>;

export const invokeRequestSchema = z.object({
  type: z.enum(invokeTypes),
  prompt: z.string().trim().min(1).max(100_000),
  payload: jsonObjectSchema.default({}),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export type InvokeRequest = z.input<typeof invokeRequestSchema>;
export type NormalizedInvokeRequest = z.output<typeof invokeRequestSchema>;

export const invocationRecordSchema = z.object({
  invocationId: z.string().min(1),
  workerId: z.string().min(1).optional(),
  type: z.enum(invokeTypes),
  prompt: z.string(),
  payload: jsonObjectSchema,
  status: z.enum(invocationStatuses),
  result: jsonValueSchema.optional(),
  error: codexDockErrorSchema.optional(),
  attempts: z.number().int().nonnegative().default(0),
  idempotencyKey: z.string().optional(),
  createdAt: z.string(),
  claimedAt: z.string().optional(),
  completedAt: z.string().optional(),
  expiresAt: z.string().optional(),
});

export type InvocationRecord = z.output<typeof invocationRecordSchema>;

export const workerRecordSchema = z.object({
  workerId: z.string().min(1),
  deviceName: z.string().min(1),
  capabilities: z.array(z.string()),
  status: z.enum(workerStatuses),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().optional(),
});

export type WorkerRecord = z.output<typeof workerRecordSchema>;

export const workerConnectRequestSchema = z.object({
  workerId: z.string().min(1),
  deviceName: z.string().min(1).default("local"),
  capabilities: z.array(z.string()).default([]),
});

export type WorkerConnectRequest = z.input<typeof workerConnectRequestSchema>;
export type NormalizedWorkerConnectRequest = z.output<typeof workerConnectRequestSchema>;

export const workerNextRequestSchema = z.object({
  workerId: z.string().min(1),
});

export type WorkerNextRequest = z.infer<typeof workerNextRequestSchema>;

export const workerNextResponseSchema = z.object({
  invocationId: z.string().min(1),
  type: z.enum(invokeTypes),
  prompt: z.string(),
  payload: jsonObjectSchema,
});

export type WorkerNextResponse = z.infer<typeof workerNextResponseSchema>;

export const workerResultRequestSchema = z.object({
  workerId: z.string().min(1),
  invocationId: z.string().min(1),
  ok: z.boolean(),
  result: jsonValueSchema.optional(),
  error: codexDockErrorSchema.optional(),
});

export type WorkerResultRequest = z.infer<typeof workerResultRequestSchema>;

export const codexEventSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
  payload: jsonObjectSchema.optional(),
});

export type CodexEvent = z.infer<typeof codexEventSchema>;

export interface CodexDockSuccess<T> {
  ok: true;
  data: T;
}

export interface CodexDockFailure {
  ok: false;
  error: CodexDockError;
}

export type CodexDockResult<T> = CodexDockSuccess<T> | CodexDockFailure;

export function makeCodexDockError(
  code: CodexDockErrorCode,
  message: string,
  options: { retryable?: boolean; details?: JsonObject } = {},
): CodexDockError {
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    ...(options.details ? { details: options.details } : {}),
  };
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
