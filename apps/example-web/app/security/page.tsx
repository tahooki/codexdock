import { DocsShell } from "../components/docs-shell";
import { createPageMetadata } from "../site-metadata";

export const metadata = createPageMetadata({
  title: "Security",
  description:
    "CodexDock security boundaries for worker tokens, scoped claims, host authorization, and production storage policy.",
  path: "/security",
});

export default function SecurityPage() {
  return (
    <DocsShell currentPath="/security">
      <section className="pageHero compact">
        <p className="eyebrow">Security model</p>
        <h1>Stable routes, product-owned authorization</h1>
        <p className="lead">
          CodexDock keeps worker claims and result submission scoped, while the
          host app remains responsible for product auth, quota, rate limits, and
          artifact storage policy.
        </p>
      </section>

      <section className="section" aria-labelledby="security-heading">
        <div className="sectionIntro">
          <p className="eyebrow">Checklist</p>
          <h2 id="security-heading">Production boundaries</h2>
        </div>
        <ul className="checkList">
          <li>Worker endpoints require a bearer worker token by default.</li>
          <li>The host app wraps invoke routes with product auth, quota, and rate limits.</li>
          <li>Workers can only submit results for invocations they claimed.</li>
          <li>Worker tokens should be high entropy, hashed, revocable, and rotatable.</li>
          <li>Large files and images should use host-owned storage, not long base64 rows.</li>
          <li>Discovery should expose public URLs only for the environment being served.</li>
        </ul>
      </section>
    </DocsShell>
  );
}
