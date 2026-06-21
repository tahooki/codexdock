import { DocsShell } from "../components/docs-shell";
import { MermaidBlock, MermaidScripts } from "../components/mermaid-block";
import { ownerDiagram, runtimeDiagram } from "../docs-data";
import { createPageMetadata } from "../site-metadata";

export const metadata = createPageMetadata({
  title: "Architecture",
  description:
    "CodexDock architecture for outbound worker polling, owner-scoped invocation queues, and host-owned persistence.",
  path: "/architecture",
});

export default function ArchitecturePage() {
  return (
    <DocsShell currentPath="/architecture">
      <section className="pageHero compact">
        <p className="eyebrow">Architecture</p>
        <h1>Outbound polling with owner-scoped work</h1>
        <p className="lead">
          The worker never needs inbound network access. It connects to the host,
          claims eligible work, runs Codex locally, and submits the result.
        </p>
      </section>

      <section className="section" aria-labelledby="runtime-heading">
        <div className="sectionIntro wide">
          <p className="eyebrow">Sequence</p>
          <h2 id="runtime-heading">Invocation lifecycle</h2>
          <p>
            The host app keeps product identity and persistence. The local worker
            keeps local runtime access and claims only queued work for its owner.
          </p>
        </div>
        <MermaidBlock chart={runtimeDiagram} />
      </section>

      <section className="section" aria-labelledby="owner-heading">
        <div className="sectionIntro wide">
          <p className="eyebrow">Owner scope</p>
          <h2 id="owner-heading">The host owns identity. CodexDock enforces scoped work.</h2>
        <p>
            The example uses an anonymous browser UUID cookie. A product app can
            swap that resolver for login, account, workspace, or system-job
            ownership. Worker tokens map back to the same owner.
        </p>
        </div>
        <MermaidBlock chart={ownerDiagram} />
      </section>

      <section className="section" aria-labelledby="boundaries-heading">
        <div className="sectionIntro">
          <p className="eyebrow">Boundaries</p>
          <h2 id="boundaries-heading">Architecture decisions</h2>
        </div>
        <div className="featureGrid twoColumn">
          <article className="feature">
            <span>01</span>
            <h3>Host-controlled persistence</h3>
            <p>
              Apps choose the persistence adapter and keep invocation ownership,
              status reads, quota, and product-level authorization in their own
              backend.
            </p>
          </article>
          <article className="feature">
            <span>02</span>
            <h3>Outbound worker traffic</h3>
            <p>
              Local machines poll the host for work, so no inbound tunnel or
              public local port is required for a user's Codex app-server.
            </p>
          </article>
        </div>
      </section>
      <MermaidScripts />
    </DocsShell>
  );
}
