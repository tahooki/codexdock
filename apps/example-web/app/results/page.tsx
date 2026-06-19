import { DocsShell } from "../components/docs-shell";

export default function ResultsPage() {
  return (
    <DocsShell currentPath="/results">
      <section className="pageHero compact">
        <p className="eyebrow">Result contracts</p>
        <h1>Validated envelopes for local worker output</h1>
        <p className="lead">
          The SDK validates completed text, object, file, and image results
          before saving them. Invalid worker payloads are rejected.
        </p>
      </section>

      <section className="section" aria-labelledby="contracts-heading">
        <div className="sectionIntro">
          <p className="eyebrow">Examples</p>
          <h2 id="contracts-heading">Common result payloads</h2>
        </div>
        <div className="codeGrid results">
          <div className="codeBlock">
            <div className="codeTitle">Text result</div>
            <pre>
              <code>{`{
  "kind": "text",
  "summary": "Generated text.",
  "text": "A concise sentence.",
  "provider": "codexdock",
  "model": "local-codex",
  "parameters": { "usage": "scene_caption" }
}`}</code>
            </pre>
          </div>
          <div className="codeBlock">
            <div className="codeTitle">Image result</div>
            <pre>
              <code>{`{
  "kind": "image",
  "summary": "Generated image artifact.",
  "filename": "thumbnail.png",
  "mediaType": "image/png",
  "encoding": "base64",
  "base64": "...",
  "parameters": { "usage": "scene_thumbnail" }
}`}</code>
            </pre>
          </div>
          <div className="codeBlock">
            <div className="codeTitle">Object result</div>
            <pre>
              <code>{`{
  "kind": "object",
  "summary": "Generated structured data.",
  "object": {
    "cards": [
      { "title": "Fast local work", "tone": "clear" }
    ]
  },
  "parameters": { "usage": "product-preview" }
}`}</code>
            </pre>
          </div>
          <div className="codeBlock">
            <div className="codeTitle">File result</div>
            <pre>
              <code>{`{
  "kind": "file",
  "summary": "Generated markdown.",
  "filename": "release-notes.md",
  "mediaType": "text/markdown",
  "encoding": "utf-8",
  "content": "## Release notes",
  "parameters": { "usage": "docs" }
}`}</code>
            </pre>
          </div>
        </div>
      </section>
    </DocsShell>
  );
}
