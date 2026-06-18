import type { ReactNode } from "react";
import { navItems } from "../docs-data";

export function DocsShell({
  children,
  currentPath,
}: {
  children: ReactNode;
  currentPath: string;
}) {
  return (
    <div className="docsShell">
      <input
        aria-hidden="true"
        className="navToggleInput"
        id="docs-nav-toggle"
        type="checkbox"
      />
      <label
        className="mobileMenuButton"
        htmlFor="docs-nav-toggle"
        aria-label="Open navigation"
      >
        <span />
        <span />
        <span />
      </label>

      <label
        className="sidebarBackdrop"
        htmlFor="docs-nav-toggle"
        aria-label="Close navigation"
      />

      <aside className="sidebar">
        <a className="brandBlock" href="/">
          <span className="brandMark" aria-hidden="true">
            CD
          </span>
          <span className="brandText">
            <strong>CodexDock</strong>
            <small>Documentation</small>
          </span>
        </a>
        <nav className="sidebarNav" aria-label="Documentation pages">
          {navItems.map((item) => {
            const active = currentPath === item.href;
            return (
              <a
                aria-current={active ? "page" : undefined}
                className={active ? "sidebarLink active" : "sidebarLink"}
                href={item.href}
                key={item.href}
              >
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="sidebarMeta" aria-label="CodexDock surfaces">
          <span>SDK</span>
          <span>CLI</span>
          <span>Worker</span>
        </div>
      </aside>

      <main className="contentShell">
        {children}
        <footer className="docsFooter">
          <span>Made by</span>
          <a href="https://github.com/tahooki">tahooki</a>
        </footer>
      </main>
    </div>
  );
}
