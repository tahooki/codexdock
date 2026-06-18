import type { CodexDockError, CodexEvent, JsonObject, JsonValue } from "@codexdock/sdk";
import {
  generatedFileResultSchema,
  generatedImageResultSchema,
  generatedObjectResultSchema,
  generatedTextResultSchema,
  makeCodexDockError,
} from "@codexdock/sdk";

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

export interface SdkCodexAdapterOptions {
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

export class SdkCodexAdapter implements CodexAdapter {
  constructor(private readonly options: SdkCodexAdapterOptions = {}) {}

  async doctor(): Promise<CodexDoctorResult> {
    try {
      const sdk = await import("@openai/codex-sdk");
      if (!("Codex" in sdk)) {
        return {
          ok: false,
          codexAvailable: false,
          authenticated: false,
          error: makeCodexDockError(
            "CODEX_NOT_AVAILABLE",
            "The installed @openai/codex-sdk package does not expose Codex.",
          ),
        };
      }

      return {
        ok: true,
        codexAvailable: true,
        authenticated: true,
        message: "@openai/codex-sdk is installed.",
      };
    } catch (error) {
      return {
        ok: false,
        codexAvailable: false,
        authenticated: false,
        error: makeCodexDockError(
          "CODEX_NOT_AVAILABLE",
          error instanceof Error ? error.message : "Codex SDK is not available.",
        ),
      };
    }
  }

  async invoke(input: CodexInvokeInput, events: CodexEventSink): Promise<CodexInvokeResult> {
    try {
      await events.emit({
        level: "info",
        message: "Codex SDK invocation started.",
        payload: { invocationId: input.invocationId, type: input.type },
      });

      const sdk = await import("@openai/codex-sdk");
      const Codex = (sdk as unknown as { Codex?: new () => unknown }).Codex;
      if (!Codex) {
        throw new Error("@openai/codex-sdk does not expose Codex.");
      }

      const codex = new Codex() as {
        startThread: (options?: SdkCodexAdapterOptions) => {
          run: (prompt: string) => Promise<unknown>;
        };
      };
      const thread = codex.startThread(this.options);
      const runResult = await thread.run(buildPrompt(input));
      const result = normalizeCodexResult(runResult);
      let finalResult = result;

      if (input.type === "generate_text") {
        const parsed = generatedTextResultSchema.safeParse(result);
        if (!parsed.success) {
          throw new Error(
            "Codex SDK did not return a generated text result with kind, text, provider, model, and parameters.",
          );
        }
        finalResult = parsed.data;
      } else if (input.type === "generate_object") {
        const parsed = generatedObjectResultSchema.safeParse(result);
        if (!parsed.success) {
          throw new Error(
            "Codex SDK did not return a generated object result with kind, parameters, and object.",
          );
        }
        finalResult = parsed.data;
      } else if (input.type === "generate_file") {
        const parsed = generatedFileResultSchema.safeParse(result);
        if (!parsed.success) {
          throw new Error(
            "Codex SDK did not return a generated file artifact with filename, mediaType, encoding, and content.",
          );
        }
        finalResult = parsed.data;
      } else if (input.type === "generate_image") {
        const parsed = generatedImageResultSchema.safeParse(result);
        if (!parsed.success) {
          throw new Error(
            "Codex SDK did not return a generated image artifact with base64 and mediaType.",
          );
        }
        finalResult = parsed.data;
      }

      await events.emit({
        level: "info",
        message: "Codex SDK invocation completed.",
        payload: { invocationId: input.invocationId },
      });

      return {
        result: finalResult,
      };
    } catch (error) {
      await events.emit({
        level: "error",
        message: "Codex SDK invocation failed.",
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}

export function createAdapter(options: SdkCodexAdapterOptions = {}): CodexAdapter {
  return new SdkCodexAdapter(options);
}

function buildPrompt(input: CodexInvokeInput): string {
  const parameters = parametersFromInput(input);

  return [
    "You are running as a local Codex worker for CodexDock.",
    "Return a concise result that can be stored as JSON by the host app.",
    "Include the original generation parameters in the top-level `parameters` field of the final JSON result.",
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
