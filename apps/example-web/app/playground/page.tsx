import { revalidatePath } from "next/cache";
import { codexdock, persistence } from "@/lib/codexdock";
import { createPairingCode } from "@/lib/connection-store";
import { getBrowserOwner } from "@/lib/owner";
import {
  getPostgresPlaygroundState,
  hasDatabaseConnection,
} from "@/lib/postgres-persistence";
import { withInvocationProgress, type InvokeType, type JsonObject } from "@codexdock/sdk";
import {
  PlaygroundCreatePanel,
  type PlaygroundPreset,
} from "../components/playground-create-panel";
import { CopyButton } from "../components/copy-button";
import { DocsShell } from "../components/docs-shell";
import {
  PlaygroundInvocationQueue,
  PlaygroundLiveStateProvider,
  PlaygroundStatusStrip,
} from "../components/playground-live-state";

export const dynamic = "force-dynamic";

const quickActions: PlaygroundPreset[] = [
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
];

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
  const currentHostUrl = hostUrl();
  const pairing = await createPairingCode(owner);
  const workerCommand = `codexdock connect ${currentHostUrl} --code ${pairing.code}
codexdock start --skip-git-repo-check`;
  const initialPlaygroundState = hasDatabaseConnection()
    ? await getPostgresPlaygroundState(owner)
    : await getMemoryPlaygroundState(owner);

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

      <PlaygroundLiveStateProvider initialState={initialPlaygroundState}>
        <section className="section" aria-labelledby="worker-heading">
          <PlaygroundStatusStrip />

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
            <p>
              Presets, invocation settings, and live results share one workspace.
            </p>
          </div>
          <div className="playgroundWorkspace">
            <PlaygroundCreatePanel
              createInvocation={createInvocation}
              presets={quickActions}
            />
            <PlaygroundInvocationQueue embedded />
          </div>
        </section>
      </PlaygroundLiveStateProvider>
    </DocsShell>
  );
}

async function getMemoryPlaygroundState(owner: Awaited<ReturnType<typeof getBrowserOwner>>) {
  const status = await codexdock.getWorkerStatus(owner);
  const invocations = persistence.listInvocations
    ? await persistence.listInvocations(owner)
    : [];

  return {
    status,
    invocations: invocations
      .filter((invocation) => invocation.status !== "cancelled")
      .map((invocation) => withInvocationProgress(invocation)),
  };
}
