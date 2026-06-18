import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://codexdock.tahooki.com"),
  title: {
    default: "CodexDock Documentation",
    template: "%s | CodexDock",
  },
  description:
    "CodexDock API routes, playground, local worker model, and owner-scoped architecture.",
  applicationName: "CodexDock",
  authors: [{ name: "tahooki", url: "https://github.com/tahooki" }],
  creator: "tahooki",
  publisher: "tahooki",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "CodexDock",
    title: "CodexDock Documentation",
    description:
      "API routes, playground, local worker model, and owner-scoped architecture for CodexDock.",
  },
  twitter: {
    card: "summary",
    title: "CodexDock Documentation",
    description:
      "API routes, playground, local worker model, and owner-scoped architecture for CodexDock.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
