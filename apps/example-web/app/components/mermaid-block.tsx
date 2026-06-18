export function MermaidBlock({ chart }: { chart: string }) {
  return (
    <div className="diagramFrame">
      <pre className="mermaid">{chart}</pre>
    </div>
  );
}

export function MermaidScripts() {
  return (
    <>
      <script
        data-codexdock-mermaid="true"
        src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"
        defer
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function renderCodexDockMermaid() {
              if (!window.mermaid) {
                window.setTimeout(renderCodexDockMermaid, 100);
                return;
              }
              if (!window.__codexdockMermaidInitialized) {
                window.mermaid.initialize({
                  startOnLoad: false,
                  theme: "base",
                  securityLevel: "loose",
                  themeVariables: {
                    background: "#ffffff",
                    primaryColor: "#ecfdf5",
                    primaryTextColor: "#111827",
                    primaryBorderColor: "#0f766e",
                    lineColor: "#64748b",
                    secondaryColor: "#eff6ff",
                    tertiaryColor: "#fff7ed",
                    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
                  }
                });
                window.__codexdockMermaidInitialized = true;
              }
              window.mermaid.run({ querySelector: ".mermaid:not([data-processed])" }).catch(function(error) {
                console.error("Failed to render Mermaid diagrams", error);
              });
            })();
          `,
        }}
      />
    </>
  );
}
