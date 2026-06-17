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
export const ownerKinds = ["user", "system"] as const;

export const invokeTypes = [
  "generate_text",
  "generate_object",
  "generate_file",
  "generate_image",
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
export type OwnerKind = (typeof ownerKinds)[number];
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

export const ownerSchema = z.object({
  ownerKind: z.enum(ownerKinds),
  ownerId: z.string().trim().min(1).max(500),
});

export type CodexDockOwner = z.infer<typeof ownerSchema>;

export const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable().default(null),
  outputTokens: z.number().int().nonnegative().nullable().default(null),
  totalTokens: z.number().int().nonnegative().nullable().default(null),
  source: z.enum(["exact", "estimated", "unavailable"]).default("unavailable"),
});

export const generatedTextResultSchema = z.object({
  kind: z.literal("text"),
  summary: z.string().optional(),
  parameters: jsonObjectSchema.default({}),
  text: z.string(),
  finishReason: z.string().min(1).optional(),
  provider: z.string().min(1).default("codexdock"),
  model: z.string().min(1).default("local-codex"),
  usage: usageSchema.default({
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    source: "unavailable",
  }),
});

export type GeneratedTextResult = z.infer<typeof generatedTextResultSchema>;

export const generatedObjectResultSchema = z.object({
  kind: z.literal("object"),
  summary: z.string().optional(),
  parameters: jsonObjectSchema.default({}),
  object: jsonObjectSchema,
  schemaName: z.string().min(1).optional(),
  schemaHash: z.string().min(1).optional(),
  provider: z.string().min(1).default("codexdock"),
  model: z.string().min(1).default("local-codex"),
});

export type GeneratedObjectResult = z.infer<typeof generatedObjectResultSchema>;

export const generatedFileResultSchema = z.object({
  kind: z.literal("file"),
  summary: z.string().optional(),
  parameters: jsonObjectSchema.default({}),
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  encoding: z.literal("utf-8"),
  content: z.string(),
});

export type GeneratedFileResult = z.infer<typeof generatedFileResultSchema>;

export const generatedImageResultSchema = z.object({
  kind: z.literal("image"),
  summary: z.string().optional(),
  parameters: jsonObjectSchema.default({}),
  filename: z.string().min(1).optional(),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  encoding: z.literal("base64"),
  base64: z.string().min(1),
  dataUri: z.string().min(1).optional(),
  promptUsed: z.string().min(1).optional(),
});

export type GeneratedImageResult = z.infer<typeof generatedImageResultSchema>;

export const generatedArtifactResultSchema = z.discriminatedUnion("kind", [
  generatedFileResultSchema,
  generatedImageResultSchema,
]);

export type GeneratedArtifactResult = z.infer<typeof generatedArtifactResultSchema>;

export const codexDockErrorSchema = z.object({
  code: z.enum(codexDockErrorCodes),
  message: z.string().min(1),
  retryable: z.boolean(),
  details: jsonObjectSchema.optional(),
});

export type CodexDockError = z.infer<typeof codexDockErrorSchema>;

export const invokeRequestSchema = z
  .object({
    ownerKind: z.enum(ownerKinds).optional(),
    ownerId: z.string().trim().min(1).max(500).optional(),
    type: z.enum(invokeTypes),
    prompt: z.string().trim().min(1).max(100_000),
    parameters: jsonObjectSchema.optional(),
    payload: jsonObjectSchema.optional(),
    requiredCapabilities: z.array(z.string().min(1)).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .transform((input) => {
    const parameters = input.parameters ?? input.payload ?? {};
    return {
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      type: input.type,
      prompt: input.prompt,
      parameters,
      payload: parameters,
      requiredCapabilities: input.requiredCapabilities ?? [input.type],
      idempotencyKey: input.idempotencyKey,
    };
  });

export type InvokeRequest = z.input<typeof invokeRequestSchema>;
export type NormalizedInvokeRequest = z.output<typeof invokeRequestSchema>;

export const invocationRecordSchema = z.object({
  invocationId: z.string().min(1),
  ownerKind: z.enum(ownerKinds),
  ownerId: z.string().min(1),
  workerId: z.string().min(1).optional(),
  type: z.enum(invokeTypes),
  prompt: z.string(),
  payload: jsonObjectSchema,
  requiredCapabilities: z.array(z.string().min(1)).default([]),
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
  ownerKind: z.enum(ownerKinds),
  ownerId: z.string().min(1),
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
  ownerKind: z.enum(ownerKinds).optional(),
  ownerId: z.string().min(1).optional(),
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
  ownerKind: z.enum(ownerKinds),
  ownerId: z.string().min(1),
  type: z.enum(invokeTypes),
  prompt: z.string(),
  parameters: jsonObjectSchema,
  payload: jsonObjectSchema,
  requiredCapabilities: z.array(z.string().min(1)).default([]),
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

export const discoveryManifestSchema = z.object({
  protocolVersion: z.string().min(1),
  appName: z.string().min(1),
  endpoints: z.object({
    discovery: z.string().url().optional(),
    invoke: z.string().url().optional(),
    getInvocation: z.string().url().optional(),
    workerStatus: z.string().url(),
    workerConnect: z.string().url(),
    workerNext: z.string().url(),
    workerResult: z.string().url(),
    artifactUpload: z.string().url().optional(),
    artifactPrepare: z.string().url().optional(),
  }),
  capabilities: z.object({
    generationTypes: z.array(z.enum(invokeTypes)).default([]),
    artifactUpload: z.array(z.enum(["inline", "multipart", "signed"])).default(["inline"]),
  }),
});

export type DiscoveryManifest = z.infer<typeof discoveryManifestSchema>;

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
