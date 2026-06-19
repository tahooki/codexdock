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
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"],
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "CodexDock",
    title: "CodexDock Documentation",
    description:
      "API routes, playground, local worker model, and owner-scoped architecture for CodexDock.",
    images: [
      {
        url: "/icon.png",
        width: 512,
        height: 512,
        alt: "CodexDock icon",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "CodexDock Documentation",
    description:
      "API routes, playground, local worker model, and owner-scoped architecture for CodexDock.",
    images: ["/icon.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
