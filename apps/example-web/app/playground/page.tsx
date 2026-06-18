import { revalidatePath } from "next/cache";
import { codexdock, persistence } from "@/lib/codexdock";
import { createPairingCode } from "@/lib/connection-store";
import { getBrowserOwner } from "@/lib/owner";
import type { InvocationRecord, InvokeType, JsonObject } from "@codexdock/sdk";
import { CopyButton } from "../components/copy-button";
import { DocsShell } from "../components/docs-shell";

export const dynamic = "force-dynamic";

const quickActions = [
  {
    type: "generate_text",
    label: "Text",
    title: "Product intro",
    cue: "Short copy",
    prompt: "Write a concise product intro for CodexDock in two sentences.",
    parameters: {
      tone: "clear",
      usage: "playground_text",
    },
  },
  {
    type: "generate_image",
    label: "Image",
    title: "Product thumbnail",
    cue: "Square asset",
    prompt: "Create a square product thumbnail for CodexDock, clean technical UI style.",
    parameters: {
      filename: "codexdock-thumbnail.png",
      usage: "playground_image",
    },
  },
  {
    type: "generate_object",
    label: "Object",
    title: "Integration cards",
    cue: "Structured JSON",
    prompt: "Create three integration cards for a developer documentation page.",
    parameters: {
      count: 3,
      usage: "playground_object",
    },
  },
  {
    type: "generate_file",
    label: "File",
    title: "README section",
    cue: "Markdown file",
    prompt: "Draft a short markdown README section for connecting a local worker.",
    parameters: {
      targetPath: "worker-quickstart.md",
      usage: "playground_file",
    },
  },
] as const;

async function createInvocation(formData: FormData) {
  "use server";

  const type = String(formData.get("type") ?? "generate_text") as InvokeType;
  const prompt = String(formData.get("prompt") ?? "").trim();
  const parametersText = String(formData.get("parameters") ?? "{}");

  if (!prompt) return;
  const owner = await getBrowserOwner();

  await codexdock.invoke(
    {
      type,
      prompt,
      parameters: parseJsonObject(parametersText),
    },
    owner,
  );
  revalidatePath("/playground");
}

async function cancelQueuedInvocation(formData: FormData) {
  "use server";

  const invocationId = String(formData.get("invocationId") ?? "").trim();
  if (!invocationId) return;

  const owner = await getBrowserOwner();
  await codexdock.cancelInvocation(invocationId, owner);
  revalidatePath("/playground");
}

function parseJsonObject(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    return {};
  }
  return {};
}

function stringifyParameters(value: JsonObject) {
  return JSON.stringify(value, null, 2);
}

function hostUrl() {
  if (process.env.CODEXDOCK_EXAMPLE_PUBLIC_URL) return process.env.CODEXDOCK_EXAMPLE_PUBLIC_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:4321";
}

function resultKind(result: unknown) {
  if (!result || typeof result !== "object" || !("kind" in result)) return null;
  const kind = (result as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
}

function imageDataUri(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const image = result as {
    kind?: unknown;
    dataUri?: unknown;
    mediaType?: unknown;
    base64?: unknown;
  };
  if (image.kind !== "image") return null;
  if (typeof image.dataUri === "string") return image.dataUri;
  if (typeof image.mediaType === "string" && typeof image.base64 === "string") {
    return `data:${image.mediaType};base64,${image.base64}`;
  }
  return null;
}

function textResult(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const value = (result as { text?: unknown; content?: unknown; summary?: unknown }).text;
  if (typeof value === "string") return value;
  const content = (result as { content?: unknown }).content;
  if (typeof content === "string") return content;
  const summary = (result as { summary?: unknown }).summary;
  return typeof summary === "string" ? summary : null;
}

function canCancelInvocation(invocation: InvocationRecord) {
  return invocation.status === "pending" || invocation.status === "running";
}

function ResultPreview({ invocation }: { invocation: InvocationRecord }) {
  const result = invocation.result;
  const kind = resultKind(result);
  const image = imageDataUri(result);
  const text = textResult(result);

  if (invocation.status === "failed") {
    return (
      <pre className="jsonPreview">{JSON.stringify(invocation.error, null, 2)}</pre>
    );
  }

  if (!result) {
    return <p className="mutedLine">Waiting for a connected worker to claim this invocation.</p>;
  }

  if (image) {
    return (
      <div className="imageResult">
        <img alt="Generated CodexDock result" src={image} />
        <pre className="jsonPreview">{JSON.stringify(result, null, 2)}</pre>
      </div>
    );
  }

  if (text) {
    return (
      <div className="textResult">
        <p>{text}</p>
        <pre className="jsonPreview">{JSON.stringify(result, null, 2)}</pre>
      </div>
    );
  }

  if (kind === "object") {
    return <pre className="jsonPreview">{JSON.stringify(result, null, 2)}</pre>;
  }

  return <pre className="jsonPreview">{JSON.stringify(result, null, 2)}</pre>;
}

export default async function PlaygroundPage() {
  const owner = await getBrowserOwner();
  const status = await codexdock.getWorkerStatus(owner);
  const invocations = persistence.listInvocations
    ? await persistence.listInvocations(owner)
    : [];
  const visibleInvocations = invocations.filter(
    (invocation) => invocation.status !== "cancelled",
  );
  const onlineWorkers = status.workers.filter((worker) => worker.status === "online");
  const currentHostUrl = hostUrl();
  const pairing = await createPairingCode(owner);
  const workerCommand = `codexdock connect ${currentHostUrl} --code ${pairing.code}
codexdock start --skip-git-repo-check`;

  return (
    <DocsShell currentPath="/playground">
      <section className="pageHero compact">
        <p className="eyebrow">Playground</p>
        <h1>Create work. Let the local worker finish it.</h1>
        <p className="lead">
          Use this page to create text, image, object, and file invocations
          against the live example routes.
        </p>
      </section>

      <section className="section" aria-labelledby="worker-heading">
        <div className="statusStrip">
          <div className={onlineWorkers.length > 0 ? "statusPill online" : "statusPill waiting"}>
            <span>Worker</span>
            <strong>{onlineWorkers.length > 0 ? "online" : "offline"}</strong>
          </div>
          <div className="statusPill">
            <span>Pending</span>
            <strong>{status.counts.pending}</strong>
          </div>
          <div className="statusPill">
            <span>Running</span>
            <strong>{status.counts.running}</strong>
          </div>
          <div className="statusPill">
            <span>Completed</span>
            <strong>{status.counts.completed}</strong>
          </div>
        </div>

        <div className="sectionIntro wide">
          <p className="eyebrow">Connect</p>
          <h2 id="worker-heading">Start a worker for this host.</h2>
          <p>
            This pairing code is scoped to this browser and expires at{" "}
            <code>{new Date(pairing.expiresAt).toLocaleTimeString()}</code>.
          </p>
        </div>
        <div className="commandBlock">
          <div className="codeTitle commandHeader">
            <span>Worker terminal</span>
            <CopyButton value={workerCommand} />
          </div>
          <pre>
            <code>{workerCommand}</code>
          </pre>
        </div>
        <p className="mutedLine">
          Run <code>codexdock logout</code> to clear saved connections and ignore
          stale CodexDock environment fallback values until the next connect.
        </p>
      </section>

      <section className="section" aria-labelledby="create-heading">
        <div className="sectionIntro wide">
          <p className="eyebrow">Create</p>
          <h2 id="create-heading">Send work to the connected Codex worker.</h2>
        </div>
        <div className="quickActionGrid">
          {quickActions.map((action) => (
            <form action={createInvocation} className="quickAction" key={action.type}>
              <input name="type" type="hidden" value={action.type} />
              <input name="prompt" type="hidden" value={action.prompt} />
              <input
                name="parameters"
                type="hidden"
                value={stringifyParameters(action.parameters)}
              />
              <span>{action.label}</span>
              <strong>{action.title}</strong>
              <p>{action.cue}</p>
              <button type="submit">Create</button>
            </form>
          ))}
        </div>

        <form action={createInvocation} className="playgroundForm">
          <div className="formHeader">
            <h3>Custom invocation</h3>
            <button type="submit">Create invocation</button>
          </div>
          <label>
            <span>Type</span>
            <select name="type" defaultValue="generate_text">
              <option value="generate_text">generate_text</option>
              <option value="generate_image">generate_image</option>
              <option value="generate_object">generate_object</option>
              <option value="generate_file">generate_file</option>
            </select>
          </label>
          <label>
            <span>Prompt</span>
            <textarea
              name="prompt"
              defaultValue="Write a short launch note for CodexDock."
            />
          </label>
          <label>
            <span>Parameters JSON</span>
            <textarea
              className="monoInput"
              name="parameters"
              defaultValue={'{\n  "usage": "custom_playground"\n}'}
            />
          </label>
        </form>
      </section>

      <section className="section" aria-labelledby="invocations-heading">
        <div className="sectionIntro wide">
          <p className="eyebrow">Results</p>
          <h2 id="invocations-heading">Invocation queue</h2>
        </div>
        <div className="invocationList">
          {visibleInvocations.length === 0 ? (
            <p className="emptyState">No invocations yet.</p>
          ) : (
            visibleInvocations.map((invocation) => (
              <article className="invocationItem" key={invocation.invocationId}>
                <div className="invocationHead">
                  <div>
                    <strong>{invocation.type}</strong>
                    <small>{invocation.invocationId}</small>
                  </div>
                  <div className="invocationActions">
                    <span className={`badge ${invocation.status}`}>{invocation.status}</span>
                    {canCancelInvocation(invocation) ? (
                      <form action={cancelQueuedInvocation}>
                        <input
                          name="invocationId"
                          type="hidden"
                          value={invocation.invocationId}
                        />
                        <button className="cancelInvocationButton" type="submit">
                          Cancel
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
                <div className="invocationMeta">
                  <span>Created {new Date(invocation.createdAt).toLocaleString()}</span>
                  {invocation.workerId ? <span>Worker {invocation.workerId}</span> : null}
                </div>
                <p className="promptLine">{invocation.prompt}</p>
                <ResultPreview invocation={invocation} />
              </article>
            ))
          )}
        </div>
      </section>
    </DocsShell>
  );
}
