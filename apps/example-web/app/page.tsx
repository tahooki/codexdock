import { DocsShell } from "./components/docs-shell";
import { createPageMetadata } from "./site-metadata";

export const metadata = createPageMetadata({
  title: "Overview",
  description:
    "CodexDock connects product UX to user-owned local Codex work through an SDK, CLI, and worker queue.",
  path: "/",
});

const principles = [
  {
    label: "Host",
    title: "Create work",
    body: "The app saves an owner-scoped invocation and returns a status URL.",
  },
  {
    label: "Worker",
    title: "Run locally",
    body: "A user-owned CLI claims work outbound near the local Codex runtime.",
  },
  {
    label: "Result",
    title: "Render safely",
    body: "Text, object, file, and image outputs return as validated envelopes.",
  },
] as const;

const docPages = [
  {
    href: "/playground",
    label: "Playground",
    meta: "Create a job and inspect the result.",
  },
  {
    href: "/api-docs",
    label: "API Docs",
    meta: "Routes, inputs, and invocation types.",
  },
  {
    href: "/architecture",
    label: "Architecture",
    meta: "Worker polling and owner scope.",
  },
  {
    href: "/results",
    label: "Results",
    meta: "Output contracts for each type.",
  },
  {
    href: "/security",
    label: "Security",
    meta: "Auth boundaries and production checks.",
  },
] as const;

export default function Home() {
  return (
    <DocsShell currentPath="/">
      <section className="pageHero homeHero">
        <div className="heroCopy">
          <p className="eyebrow">CodexDock</p>
          <h1>Local Codex, connected to your product.</h1>
          <p className="lead">
            CodexDock lets a web app create AI work, while each user runs that
            work through their own local Codex environment.
          </p>
          <div className="heroActions" aria-label="Primary documentation links">
            <a href="/playground" className="buttonLink">
              Open Playground
            </a>
            <a href="/api-docs" className="textLink">
              Read the API
            </a>
          </div>
        </div>
        <div className="heroConsole" aria-label="CodexDock runtime preview">
          <div className="consoleHeader">
            <span>codexdock</span>
            <strong>local worker</strong>
          </div>
          <ol>
            <li>
              <span>01</span>
              <strong>Host creates invocation</strong>
            </li>
            <li>
              <span>02</span>
              <strong>Worker claims owner work</strong>
            </li>
            <li>
              <span>03</span>
              <strong>Codex returns result</strong>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="model-heading">
        <div className="sectionIntro">
          <p className="eyebrow">Runtime model</p>
          <h2 id="model-heading">A small bridge between product UX and local AI work.</h2>
        </div>
        <div className="featureGrid">
          {principles.map((item) => (
            <article className="feature" key={item.label}>
              <span>{item.label}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section split" id="install" aria-labelledby="install-heading">
        <div className="sectionIntro">
          <p className="eyebrow">Install</p>
          <h2 id="install-heading">SDK in the host. CLI on the local machine.</h2>
        </div>
        <div className="codeGrid singleColumn">
          <div className="codeBlock">
            <div className="codeTitle">Host web app</div>
            <pre>
              <code>{`pnpm add @codexdock/sdk`}</code>
            </pre>
          </div>
          <div className="codeBlock">
            <div className="codeTitle">Local worker</div>
            <pre>
              <code>{`pnpm add -g codexdock`}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="pages-heading">
        <div className="sectionIntro">
          <p className="eyebrow">Docs</p>
          <h2 id="pages-heading">Documentation split by the way teams adopt it.</h2>
        </div>
        <div className="docLinkGrid">
          {docPages.map((item) => (
            <a className="docLinkCard" href={item.href} key={item.href}>
              <strong>{item.label}</strong>
              <p>{item.meta}</p>
            </a>
          ))}
        </div>
      </section>
    </DocsShell>
  );
}
