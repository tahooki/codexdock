import { DocsShell } from "../components/docs-shell";
import { invocationTypes, routeRows } from "../docs-data";

export default function ApiDocsPage() {
  return (
    <DocsShell currentPath="/api-docs">
      <section className="pageHero compact">
        <p className="eyebrow">API document</p>
        <h1>Host routes and invocation API</h1>
        <p className="lead">
          CodexDock exposes a conventional route surface for creating
          owner-scoped work, connecting local workers, claiming jobs, and reading
          completed results.
        </p>
      </section>

      <section className="section" aria-labelledby="routes-heading">
        <div className="sectionIntro wide">
          <p className="eyebrow">Routes</p>
          <h2 id="routes-heading">Default host endpoints</h2>
          <p>
            These paths are defaults, not the security boundary. A host can mount
            them elsewhere as long as discovery points the CLI to the right URLs.
          </p>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Route</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {routeRows.map(([method, route, purpose]) => (
                <tr key={route}>
                  <td>
                    <code>{method}</code>
                  </td>
                  <td>
                    <code>{route}</code>
                  </td>
                  <td>{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section split" aria-labelledby="invoke-heading">
        <div className="sectionIntro">
          <p className="eyebrow">Create work</p>
          <h2 id="invoke-heading">One invocation lifecycle, four generation types.</h2>
          <p>
            The type controls the worker capability and result envelope. The host
            can attach business context through <code>parameters</code>.
          </p>
        </div>
        <div className="codeBlock tall">
          <div className="codeTitle">Server-side invocation</div>
          <pre>
            <code>{`const invocation = await codexdock.invoke({
  type: "generate_object",
  prompt: "Create four product cards.",
  parameters: { count: 4, usage: "product-preview" },
});

// {
//   invocationId: "inv_123",
//   status: "pending",
//   statusUrl: "/api/codexdock/invocations/inv_123",
//   progress: {
//     phase: "queued",
//     steps: [
//       { key: "received", status: "complete" },
//       { key: "processing", status: "pending" },
//       { key: "result", status: "pending" }
//     ]
//   }
// }`}</code>
          </pre>
        </div>
        <div className="typeGrid" aria-label="Invocation types">
          {invocationTypes.map(([type, kind, use]) => (
            <article className="typeCard" key={type}>
              <strong>{type}</strong>
              <span>{kind} result</span>
              <p>{use}</p>
            </article>
          ))}
        </div>
      </section>
    </DocsShell>
  );
}
