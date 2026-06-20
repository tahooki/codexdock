import { DocsShell } from "../components/docs-shell";
import { invocationUseCases, routeRows } from "../docs-data";

export default function ApiDocsPage() {
  return (
    <DocsShell currentPath="/api-docs">
      <section className="pageHero compact">
        <p className="eyebrow">API document</p>
        <h1>Invocation types for product generation</h1>
        <p className="lead">
          CodexDock creates owner-scoped AI work through one invocation API.
          Choose the generation type by the result shape your product needs:
          text, structured object, file, or image.
        </p>
      </section>

      <section className="section" aria-labelledby="usage-heading">
        <div className="sectionIntro wide">
          <p className="eyebrow">Main usage</p>
          <h2 id="usage-heading">Pick the result envelope first.</h2>
          <p>
            The host sends a prompt plus product context in{" "}
            <code>parameters</code>. The worker returns a validated envelope that
            matches the requested type.
          </p>
        </div>
        <div className="usageGrid" aria-label="Primary invocation types">
          {invocationUseCases.map((item) => (
            <article className="usageCard" key={item.type}>
              <div className="usageMeta">
                <code>{item.type}</code>
                <span>{item.kind} result</span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.use}</p>
              <dl>
                <div>
                  <dt>Good for</dt>
                  <dd>{item.examples}</dd>
                </div>
                <div>
                  <dt>Result shape</dt>
                  <dd>
                    <code>{item.result}</code>
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="section split" aria-labelledby="invoke-heading">
        <div className="sectionIntro">
          <p className="eyebrow">Create work</p>
          <h2 id="invoke-heading">The same invoke shape works for every type.</h2>
          <p>
            Change <code>type</code> to select the worker capability and result
            contract. Use <code>parameters</code> for business context such as
            usage, count, locale, filename, scene ID, or target path.
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
      </section>

      <section className="section split" aria-labelledby="examples-heading">
        <div className="sectionIntro">
          <p className="eyebrow">Examples</p>
          <h2 id="examples-heading">Use the type that matches the job.</h2>
          <p>
            These examples use the same lifecycle: the host creates a pending
            invocation, a local worker claims it, and the completed result is
            read from the status URL.
          </p>
        </div>
        <div className="codeGrid singleColumn">
          <div className="codeBlock">
            <div className="codeTitle">Common invocation types</div>
            <pre>
              <code>{`await codexdock.invoke({
  type: "generate_text",
  prompt: "Write a friendly caption for this scene.",
  parameters: { usage: "scene_caption", tone: "friendly" },
});

await codexdock.invoke({
  type: "generate_object",
  prompt: "Create four product cards.",
  parameters: { usage: "product-preview", count: 4 },
});

await codexdock.invoke({
  type: "generate_file",
  prompt: "Draft concise release notes.",
  parameters: { usage: "release-doc", targetPath: "CHANGELOG.md" },
});

await codexdock.invoke({
  type: "generate_image",
  prompt: "Create a square avatar image.",
  parameters: { usage: "avatar", filename: "avatar.png" },
});`}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="routes-heading">
        <div className="sectionIntro wide">
          <p className="eyebrow">Route reference</p>
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
    </DocsShell>
  );
}
