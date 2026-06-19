import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { CodexDockError, CodexEvent, JsonObject, JsonValue } from "@codexdock/sdk";
import {
  generatedFileResultSchema,
  generatedImageResultSchema,
  generatedObjectResultSchema,
  generatedTextResultSchema,
  makeCodexDockError,
} from "@codexdock/sdk";

const appServerRequestTimeoutMs = 30 * 1000;
const appServerInvocationTimeoutMs = 5 * 60 * 1000;

export interface CodexInvokeInput {
  invocationId: string;
  type: string;
  prompt: string;
  parameters?: JsonObject;
  payload?: JsonObject;
}

export interface CodexInvokeResult {
  result: JsonValue;
  logs?: CodexEvent[];
}

export interface CodexEventSink {
  emit(event: CodexEvent): Promise<void>;
}

export interface CodexDoctorResult {
  ok: boolean;
  codexAvailable: boolean;
  authenticated: boolean;
  message?: string;
  error?: CodexDockError;
}

export interface CodexAdapter {
  doctor(): Promise<CodexDoctorResult>;
  invoke(input: CodexInvokeInput, events: CodexEventSink): Promise<CodexInvokeResult>;
}

export interface CodexAppServerAdapterOptions {
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
}

export class ConsoleEventSink implements CodexEventSink {
  async emit(event: CodexEvent): Promise<void> {
    const prefix = `[${event.level}]`;
    if (event.level === "error") {
      console.error(prefix, event.message, event.payload ?? "");
      return;
    }
    console.log(prefix, event.message, event.payload ?? "");
  }
}

export class MemoryEventSink implements CodexEventSink {
  readonly events: CodexEvent[] = [];

  async emit(event: CodexEvent): Promise<void> {
    this.events.push(event);
  }
}

export class CodexAppServerAdapter implements CodexAdapter {
  constructor(private readonly options: CodexAppServerAdapterOptions = {}) {}

  async doctor(): Promise<CodexDoctorResult> {
    const events = new MemoryEventSink();
    const client = new CodexAppServerClient(this.options, events);
    try {
      await client.start();

      return {
        ok: true,
        codexAvailable: true,
        authenticated: true,
        message: "@openai/codex app-server is available.",
      };
    } catch (error) {
      return {
        ok: false,
        codexAvailable: false,
        authenticated: false,
        error: makeCodexDockError(
          "CODEX_NOT_AVAILABLE",
          error instanceof Error ? error.message : "Codex app-server is not available.",
        ),
      };
    } finally {
      client.close();
    }
  }

  async invoke(input: CodexInvokeInput, events: CodexEventSink): Promise<CodexInvokeResult> {
    try {
      await events.emit({
        level: "info",
        message: "Codex app-server invocation started.",
        payload: { invocationId: input.invocationId, type: input.type },
      });

      const finalResult = await invokeWithAppServer(input, this.options, events);

      await events.emit({
        level: "info",
        message: "Codex app-server invocation completed.",
        payload: { invocationId: input.invocationId },
      });

      return {
        result: finalResult,
      };
    } catch (error) {
      await events.emit({
        level: "error",
        message: "Codex app-server invocation failed.",
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}

export function createAdapter(options: CodexAppServerAdapterOptions = {}): CodexAdapter {
  return new CodexAppServerAdapter(options);
}

function buildPrompt(input: CodexInvokeInput): string {
  const parameters = parametersFromInput(input);

  return [
    "You are running as a local Codex worker for CodexDock.",
    "Return a concise result that can be stored as JSON by the host app.",
    "Include the original generation parameters in the top-level `parameters` field of the final JSON result.",
    "Do not modify files in the local working directory; return the requested artifact in JSON.",
    "",
    `Invocation type: ${input.type}`,
    "",
    resultContractFor(input.type),
    "",
    "Prompt:",
    input.prompt,
    "",
    "Generation parameters:",
    JSON.stringify(parameters, null, 2),
  ].join("\n");
}

function resultContractFor(type: string): string {
  if (type === "generate_text") {
    return [
      "Return only JSON matching this shape:",
      `{"kind":"text","summary":"...","parameters":{...},"text":"...","provider":"codexdock","model":"local-codex","usage":{"inputTokens":null,"outputTokens":null,"totalTokens":null,"source":"unavailable"}}`,
      "The text field must contain the generated prose for the host app.",
    ].join("\n");
  }

  if (type === "generate_object") {
    return [
      "Return only JSON matching this shape:",
      `{"kind":"object","summary":"...","parameters":{...},"object":{...}}`,
      "The object field must contain the structured JSON result for the host app.",
    ].join("\n");
  }

  if (type === "generate_file") {
    return [
      "Return only JSON matching this shape:",
      `{"kind":"file","summary":"...","parameters":{...},"filename":"...","mediaType":"text/markdown","encoding":"utf-8","content":"..."}`,
    ].join("\n");
  }

  if (type === "generate_image") {
    return [
      "Return only JSON matching this shape:",
      `{"kind":"image","summary":"...","parameters":{...},"filename":"...","mediaType":"image/png","encoding":"base64","base64":"...","dataUri":"data:image/png;base64,...","promptUsed":"..."}`,
      "The base64 field must contain the generated image bytes.",
    ].join("\n");
  }

  return "Return JSON data for the host app. Include a top-level `parameters` object.";
}

async function invokeWithAppServer(
  input: CodexInvokeInput,
  options: CodexAppServerAdapterOptions,
  events: CodexEventSink,
): Promise<JsonValue> {
  const parameters = parametersFromInput(input);
  const client = new CodexAppServerClient(options, events);

  try {
    await client.start();
    const run = await client.runPrompt(
      input.type === "generate_image" ? buildAppServerImagePrompt(input) : buildPrompt(input),
    );

    if (input.type === "generate_image") {
      const image = run.image;
      if (!image) {
        throw new Error("Codex app-server completed without an image generation result.");
      }

      const bytes = Buffer.from(image.base64, "base64");
      const mediaType = detectImageMediaType(bytes);
      if (!mediaType) {
        throw new Error("Codex app-server returned image data with an unknown media type.");
      }

      const filename = filenameFromParameters(parameters, input.invocationId, mediaType);
      return generatedImageResultSchema.parse({
        kind: "image",
        summary: "Image generated by the local Codex image generation tool.",
        parameters,
        filename,
        mediaType,
        encoding: "base64",
        base64: image.base64,
        promptUsed: image.revisedPrompt ?? input.prompt,
      });
    }

    if (!run.finalText) {
      throw new Error("Codex app-server completed without a final text response.");
    }

    const result = normalizeCodexResult(run.finalText);
    if (input.type === "generate_text") {
      const parsed = generatedTextResultSchema.safeParse(result);
      if (!parsed.success) {
        throw new Error(
          "Codex app-server did not return a generated text result with kind, text, provider, model, and parameters.",
        );
      }
      return parsed.data;
    }

    if (input.type === "generate_object") {
      const parsed = generatedObjectResultSchema.safeParse(result);
      if (!parsed.success) {
        throw new Error(
          "Codex app-server did not return a generated object result with kind, parameters, and object.",
        );
      }
      return parsed.data;
    }

    if (input.type === "generate_file") {
      const parsed = generatedFileResultSchema.safeParse(result);
      if (!parsed.success) {
        throw new Error(
          "Codex app-server did not return a generated file artifact with filename, mediaType, encoding, and content.",
        );
      }
      return parsed.data;
    }

    return result;
  } finally {
    client.close();
  }
}

function buildAppServerImagePrompt(input: CodexInvokeInput): string {
  const parameters = parametersFromInput(input);
  return [
    "$imagegen",
    "Generate a raster image for this CodexDock invocation.",
    "Use the built-in image generation tool. Do not write code, draw with SVG/canvas, or create a placeholder.",
    "",
    `Prompt: ${input.prompt}`,
    "",
    "Generation parameters:",
    JSON.stringify(parameters, null, 2),
    "",
    "After the image is generated, reply with one short sentence.",
  ].join("\n");
}

interface AppServerImageResult {
  base64: string;
  revisedPrompt?: string | null;
  savedPath?: string | null;
}

interface AppServerRunResult {
  finalText: string | null;
  image: AppServerImageResult | null;
}

interface AppServerTurnState {
  agentMessages: Array<{ text: string; phase: string | null }>;
  image: AppServerImageResult | null;
  completed: AppServerRunResult | null;
}

type AppServerRequestId = string | number;

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private stderrTail = "";
  private nextId = 1;
  private pending = new Map<AppServerRequestId, PendingRequest>();
  private closing = false;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private turnState: AppServerTurnState | null = null;
  private turnError: Error | null = null;
  private turnResolve: ((value: AppServerRunResult) => void) | null = null;
  private turnReject: ((error: Error) => void) | null = null;

  constructor(
    private readonly options: CodexAppServerAdapterOptions,
    private readonly events: CodexEventSink,
  ) {}

  async start(): Promise<void> {
    const codexScript = resolveCodexCliScript();
    this.child = spawn(process.execPath, [
      codexScript,
      "app-server",
      "--stdio",
      "--enable",
      "image_generation",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => this.onStderr(chunk));
    this.child.on("error", (error) => {
      if (this.closing) return;
      this.rejectAll(new Error(`Codex app-server failed to start: ${error.message}`));
    });
    this.child.on("exit", (code, signal) => {
      if (this.closing) return;
      const detail = this.stderrTail ? ` Last stderr: ${this.stderrTail}` : "";
      const message = `Codex app-server exited before invocation completed (${signal ?? code}).${detail}`;
      this.rejectAll(new Error(message));
    });

    const initialized = await this.request("initialize", {
      clientInfo: {
        name: "codexdock",
        title: "CodexDock",
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    await this.events.emit({
      level: "info",
      message: "Codex app-server initialized.",
      payload: {
        userAgent: stringField(initialized, "userAgent"),
      },
    });
    this.notify("initialized", {});
  }

  async runPrompt(prompt: string): Promise<AppServerRunResult> {
    const cwd = this.options.workingDirectory ?? process.cwd();
    const threadResponse = await this.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: {
        "features.image_generation": true,
      },
      ephemeral: true,
    });
    const thread = objectField(threadResponse, "thread");
    const threadId = stringField(thread, "id");
    if (!threadId) {
      throw new Error("Codex app-server did not return a thread id.");
    }
    this.threadId = threadId;
    this.turnError = null;
    this.turnState = {
      agentMessages: [],
      image: null,
      completed: null,
    };

    const turnResponse = await this.request("turn/start", {
      threadId,
      cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      input: [
        {
          type: "text",
          text: prompt,
          text_elements: [],
        },
      ],
    });
    this.turnId = stringField(objectField(turnResponse, "turn"), "id");

    return await this.waitForTurnCompletion();
  }

  close(): void {
    this.closing = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Codex app-server client closed."));
      this.pending.delete(id);
    }
    this.rejectTurn(new Error("Codex app-server client closed."));
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.child = null;
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs = appServerRequestTimeoutMs,
  ): Promise<unknown> {
    if (!this.child) throw new Error("Codex app-server is not running.");
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timeout });
      try {
        this.child?.stdin.write(JSON.stringify({ id, method, params }) + "\n", (error?: Error | null) => {
          if (!error) return;
          const pending = this.pending.get(id);
          if (!pending) return;
          clearTimeout(pending.timeout);
          this.pending.delete(id);
          pending.reject(new Error(`Failed to write Codex app-server ${method}: ${error.message}`));
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.child) throw new Error("Codex app-server is not running.");
    this.child.stdin.write(JSON.stringify({ method, params }) + "\n");
  }

  private waitForTurnCompletion(): Promise<AppServerRunResult> {
    if (this.turnState?.completed) return Promise.resolve(this.turnState.completed);
    if (this.turnError) return Promise.reject(this.turnError);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.turnResolve = null;
        this.turnReject = null;
        reject(new Error("Timed out waiting for Codex app-server invocation."));
      }, appServerInvocationTimeoutMs);
      this.turnResolve = (value) => {
        clearTimeout(timeout);
        resolve(value);
      };
      this.turnReject = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
    });
  }

  private onStdout(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) this.handleMessageLine(line);
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private onStderr(chunk: Buffer): void {
    this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-4_000);
  }

  private handleMessageLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      void this.events.emit({
        level: "debug",
        message: "Codex app-server emitted non-JSON output.",
        payload: { line: line.slice(0, 2_000) },
      });
      return;
    }

    if (!message || typeof message !== "object") return;
    const record = message as Record<string, unknown>;
    const id = typeof record.id === "number" || typeof record.id === "string" ? record.id : null;
    const method = typeof record.method === "string" ? record.method : null;

    if (id !== null && ("result" in record || "error" in record)) {
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      if (record.error) {
        pending.reject(new Error(`${pending.method} failed: ${JSON.stringify(record.error)}`));
        return;
      }
      pending.resolve(record.result);
      return;
    }

    if (id !== null && method) {
      this.respondToServerRequest(id, method);
      return;
    }

    if (method === "error") {
      this.rejectTurn(new Error(`Codex app-server error: ${JSON.stringify(record.params)}`));
      return;
    }

    if (method === "item/completed") {
      this.handleCompletedItem(objectField(record, "params"));
      return;
    }

    if (method === "turn/completed") {
      this.handleCompletedTurn(objectField(record, "params"));
    }
  }

  private respondToServerRequest(id: AppServerRequestId, method: string): void {
    if (!this.child) return;
    const result = method.includes("requestApproval")
      ? { decision: "approved" }
      : undefined;
    const response = result
      ? { id, result }
      : { id, error: { code: -32601, message: `CodexDock does not implement ${method}.` } };
    this.child.stdin.write(JSON.stringify(response) + "\n");
  }

  private handleCompletedItem(params: Record<string, unknown> | null): void {
    const item = objectField(params, "item");
    this.collectCompletedItem(item);
  }

  private handleCompletedTurn(params: Record<string, unknown> | null): void {
    if (!params) return;
    const threadId = stringField(params, "threadId");
    if (this.threadId && threadId && threadId !== this.threadId) return;

    const turn = objectField(params, "turn");
    if (!turn) return;
    const turnId = stringField(turn, "id");
    if (this.turnId && turnId && turnId !== this.turnId) return;

    const items = Array.isArray(turn.items) ? turn.items : [];
    for (const item of items) {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
      this.collectCompletedItem(record);
    }

    const status = stringField(turn, "status");
    if (status === "failed") {
      this.rejectTurn(new Error(formatTurnError(objectField(turn, "error"))));
      return;
    }
    if (status && status !== "completed") {
      this.rejectTurn(new Error(`Codex app-server turn ended with status ${status}.`));
      return;
    }

    this.resolveTurn(this.buildRunResult());
  }

  private collectCompletedItem(item: Record<string, unknown> | null): void {
    if (!item || !this.turnState) return;

    if (item.type === "agentMessage") {
      const text = stringField(item, "text");
      if (text) {
        this.turnState.agentMessages.push({
          text,
          phase: stringField(item, "phase"),
        });
      }
      return;
    }

    if (item.type !== "imageGeneration") return;

    const base64 = stringField(item, "result");
    if (!base64) return;

    this.turnState.image = {
      base64,
      revisedPrompt: stringField(item, "revisedPrompt"),
      savedPath: stringField(item, "savedPath"),
    };
  }

  private buildRunResult(): AppServerRunResult {
    const messages = this.turnState?.agentMessages ?? [];
    const finalMessage =
      [...messages].reverse().find((message) => message.phase === "final_answer") ??
      messages.at(-1) ??
      null;
    return {
      finalText: finalMessage?.text ?? null,
      image: this.turnState?.image ?? null,
    };
  }

  private resolveTurn(result: AppServerRunResult): void {
    if (this.turnState) this.turnState.completed = result;
    this.turnError = null;
    this.turnResolve?.(result);
    this.turnResolve = null;
    this.turnReject = null;
  }

  private rejectTurn(error: Error): void {
    if (this.turnState?.completed) return;
    this.turnError = error;
    this.turnReject?.(error);
    this.turnResolve = null;
    this.turnReject = null;
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
    this.rejectTurn(error);
  }
}

function formatTurnError(error: Record<string, unknown> | null): string {
  const message = stringField(error, "message") ?? "Codex app-server turn failed.";
  const details = stringField(error, "additionalDetails");
  return details ? `${message} ${details}` : message;
}

function resolveCodexCliScript(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("@openai/codex/package.json");
  return join(dirname(packageJsonPath), "bin", "codex.js");
}

function detectImageMediaType(bytes: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function filenameFromParameters(
  parameters: JsonObject,
  invocationId: string,
  mediaType: "image/png" | "image/jpeg" | "image/webp",
): string {
  if (typeof parameters.filename === "string" && parameters.filename.trim()) {
    return parameters.filename.trim();
  }
  const extension = mediaType === "image/png" ? "png" : mediaType === "image/jpeg" ? "jpg" : "webp";
  return `${invocationId}.${extension}`;
}

function objectField(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const child = (value as Record<string, unknown>)[key];
  return child && typeof child === "object" && !Array.isArray(child)
    ? (child as Record<string, unknown>)
    : null;
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const child = (value as Record<string, unknown>)[key];
  return typeof child === "string" ? child : null;
}

function parametersFromInput(input: CodexInvokeInput): JsonObject {
  return input.parameters ?? input.payload ?? {};
}

function normalizeCodexResult(result: unknown): JsonValue {
  if (typeof result === "string") {
    return parseJsonResult(result) ?? { summary: result };
  }

  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const finalResponse = record.finalResponse ?? record.final_response ?? record.response;
    if (typeof finalResponse === "string") {
      return parseJsonResult(finalResponse) ?? { summary: finalResponse };
    }
    return toJsonValue(record);
  }

  return { summary: String(result) };
}

function parseJsonResult(value: string): JsonValue | null {
  const trimmed = extractJsonCandidate(value.trim());
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  try {
    return toJsonValue(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function extractJsonCandidate(value: string): string {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : value;
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }

  if (value && typeof value === "object") {
    const output: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = toJsonValue(child);
    }
    return output;
  }

  return String(value);
}
