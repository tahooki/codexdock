import { revalidatePath } from "next/cache";
import { codexDockOwner, codexdock, persistence } from "@/lib/codexdock";
import type { InvokeType } from "@codexdock/protocol";

export const dynamic = "force-dynamic";

async function createInvocation(formData: FormData) {
  "use server";

  const type = String(formData.get("type") ?? "generate_object") as InvokeType;
  const prompt = String(formData.get("prompt") ?? "");
  const parametersText = String(formData.get("parameters") ?? "{}");
  let parameters: Record<string, unknown>;

  try {
    parameters = JSON.parse(parametersText) as Record<string, unknown>;
  } catch {
    parameters = {};
  }

  await codexdock.invoke({ type, prompt, parameters });
  revalidatePath("/");
}

export default async function Home() {
  const status = await codexdock.getWorkerStatus();
  const invocations = persistence.listInvocations
    ? await persistence.listInvocations(codexDockOwner)
    : [];
  const hasOnlineWorker = status.workers.some((worker) => worker.status === "online");

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CodexDock Example</p>
          <h1>Use local Codex as your app&apos;s AI runtime.</h1>
        </div>
        <div className={hasOnlineWorker ? "worker online" : "worker offline"}>
          <span>{hasOnlineWorker ? "Worker online" : "Worker offline"}</span>
          <strong>{status.workers.length}</strong>
        </div>
      </header>

      <section className="grid">
        <form action={createInvocation} className="panel form">
          <h2>Create invocation</h2>
          <label>
            Type
            <select name="type" defaultValue="generate_object">
              <option value="generate_text">generate_text</option>
              <option value="generate_object">generate_object</option>
              <option value="generate_file">generate_file</option>
              <option value="generate_image">generate_image</option>
            </select>
          </label>
          <label>
            Prompt
            <textarea
              name="prompt"
              defaultValue="Create five product cards for CodexDock."
            />
          </label>
          <label>
            Parameters JSON
            <textarea
              name="parameters"
              defaultValue={'{"count":5,"format":"json","usage":"example"}'}
            />
          </label>
          <button type="submit">Create pending invocation</button>
          {!hasOnlineWorker ? (
            <p className="notice">
              로컬 worker가 아직 연결되지 않았습니다. 다른 터미널에서{" "}
              <code>pnpm worker</code>를 실행하면 pending invocation이 처리됩니다.
            </p>
          ) : null}
        </form>

        <section className="panel">
          <div className="panelTitle">
            <h2>Invocations</h2>
            <span>
              pending {status.counts.pending} / running {status.counts.running} /
              completed {status.counts.completed}
            </span>
          </div>
          <div className="list">
            {invocations.length === 0 ? (
              <p className="empty">아직 invocation이 없습니다.</p>
            ) : (
              invocations.map((invocation) => (
                <article className="item" key={invocation.invocationId}>
                  <div className="itemHead">
                    <div>
                      <strong>{invocation.type}</strong>
                      <small>{invocation.invocationId}</small>
                    </div>
                    <span className={`badge ${invocation.status}`}>
                      {invocation.status}
                    </span>
                  </div>
                  <pre>
                    {JSON.stringify(
                      invocation.result ?? invocation.error ?? invocation.payload,
                      null,
                      2,
                    )}
                  </pre>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
