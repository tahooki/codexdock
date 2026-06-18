import { revalidatePath } from "next/cache";
import { codexdock, persistence } from "@/lib/codexdock";
import { createPairingCode } from "@/lib/connection-store";
import { getBrowserOwner } from "@/lib/owner";
import type { InvokeType, JsonObject } from "@codexdock/sdk";
import { CopyButton } from "../components/copy-button";
import { DocsShell } from "../components/docs-shell";
import {
  PlaygroundInvocationQueue,
  PlaygroundStatusStrip,
} from "../components/playground-live-state";

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

export default async function PlaygroundPage() {
  const owner = await getBrowserOwner();
  const status = await codexdock.getWorkerStatus(owner);
  const invocations = persistence.listInvocations
    ? await persistence.listInvocations(owner)
    : [];
  const visibleInvocations = invocations.filter(
    (invocation) => invocation.status !== "cancelled",
  );
  const currentHostUrl = hostUrl();
  const pairing = await createPairingCode(owner);
  const workerCommand = `codexdock connect ${currentHostUrl} --code ${pairing.code}
codexdock start --skip-git-repo-check`;
  const initialPlaygroundState = {
    status,
    invocations: visibleInvocations,
  };

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
        <PlaygroundStatusStrip initialState={initialPlaygroundState} />

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

      <PlaygroundInvocationQueue initialState={initialPlaygroundState} />
    </DocsShell>
  );
}
