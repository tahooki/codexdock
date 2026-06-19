"use client";

import { useEffect, useState } from "react";
import type { InvocationRecord, WorkerStatusResult } from "@codexdock/sdk";

interface PlaygroundState {
  status: WorkerStatusResult;
  invocations: InvocationRecord[];
}

interface PlaygroundStateResponse extends PlaygroundState {
  ok: boolean;
}

export function PlaygroundStatusStrip({ initialState }: { initialState: PlaygroundState }) {
  const state = usePlaygroundState(initialState);
  const onlineWorkers = state.status.workers.filter((worker) => worker.status === "online");

  return (
    <StatusStrip counts={state.status.counts} onlineWorkerCount={onlineWorkers.length} />
  );
}

export function PlaygroundInvocationQueue({ initialState }: { initialState: PlaygroundState }) {
  const state = usePlaygroundState(initialState);

  return <InvocationQueue invocations={state.invocations} onRefresh={state.refresh} />;
}

function usePlaygroundState(initialState: PlaygroundState) {
  const [state, setState] = useState(initialState);
  const hasActiveInvocations = state.invocations.some((invocation) =>
    canCancelInvocation(invocation),
  );

  async function refreshState() {
    const response = await fetch("/api/codexdock/playground/state", {
      cache: "no-store",
    });
    if (!response.ok) return;

    const payload = (await response.json()) as PlaygroundStateResponse;
    if (payload.ok) {
      setState({
        status: payload.status,
        invocations: payload.invocations,
      });
    }
  }

  useEffect(() => {
    const intervalMs = hasActiveInvocations ? 1_000 : 2_500;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshState();
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [hasActiveInvocations]);

  return { ...state, refresh: refreshState };
}

function StatusStrip({
  counts,
  onlineWorkerCount,
}: {
  counts: WorkerStatusResult["counts"];
  onlineWorkerCount: number;
}) {
  return (
    <div className="statusStrip">
      <div className={onlineWorkerCount > 0 ? "statusPill online" : "statusPill waiting"}>
        <span>Worker</span>
        <strong>{onlineWorkerCount > 0 ? "online" : "offline"}</strong>
      </div>
      <div className="statusPill">
        <span>Pending</span>
        <strong>{counts.pending}</strong>
      </div>
      <div className="statusPill">
        <span>Running</span>
        <strong>{counts.running}</strong>
      </div>
      <div className="statusPill">
        <span>Completed</span>
        <strong>{counts.completed}</strong>
      </div>
    </div>
  );
}

function InvocationQueue({
  invocations,
  onRefresh,
}: {
  invocations: InvocationRecord[];
  onRefresh: () => Promise<void>;
}) {
  return (
    <section className="section" aria-labelledby="invocations-heading">
      <div className="sectionIntro wide">
        <p className="eyebrow">Results</p>
        <h2 id="invocations-heading">Invocation queue</h2>
      </div>
      <div className="invocationList">
        {invocations.length === 0 ? (
          <p className="emptyState">No invocations yet.</p>
        ) : (
          invocations.map((invocation) => (
            <InvocationItem
              invocation={invocation}
              key={invocation.invocationId}
              onRefresh={onRefresh}
            />
          ))
        )}
      </div>
    </section>
  );
}

function InvocationItem({
  invocation,
  onRefresh,
}: {
  invocation: InvocationRecord;
  onRefresh: () => Promise<void>;
}) {
  const [isCancelling, setIsCancelling] = useState(false);

  async function cancelInvocation() {
    setIsCancelling(true);
    try {
      await fetch(`/api/codexdock/invocations/${invocation.invocationId}`, {
        method: "DELETE",
      });
      await onRefresh();
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <article className="invocationItem">
      <div className="invocationHead">
        <div>
          <strong>{invocation.type}</strong>
          <small>{invocation.invocationId}</small>
        </div>
        <div className="invocationActions">
          <span className={`badge ${invocation.status}`}>{invocation.status}</span>
          {canCancelInvocation(invocation) ? (
            <button
              className="cancelInvocationButton"
              disabled={isCancelling}
              onClick={cancelInvocation}
              type="button"
            >
              Cancel
            </button>
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
  );
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
