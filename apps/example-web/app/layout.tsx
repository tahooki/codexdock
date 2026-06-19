import type { Metadata } from "next";
import Script from "next/script";
import { Suspense, type ReactNode } from "react";
import { GoogleAnalyticsPageView } from "./components/google-analytics-page-view";
import "./styles.css";

const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();
const gaScriptSrc = gaMeasurementId
  ? `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaMeasurementId)}`
  : undefined;
const gaInitScript = gaMeasurementId
  ? `
window.dataLayer = window.dataLayer || [];
function gtag(){window.dataLayer.push(arguments);}
gtag("js", new Date());
gtag("config", ${JSON.stringify(gaMeasurementId)}, { send_page_view: false });
`
  : "";

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
      <body>
        {children}
        {gaScriptSrc && gaMeasurementId ? (
          <>
            <Script src={gaScriptSrc} strategy="afterInteractive" />
            <Script id="ga4-init" strategy="afterInteractive">
              {gaInitScript}
            </Script>
            <Suspense fallback={null}>
              <GoogleAnalyticsPageView measurementId={gaMeasurementId} />
            </Suspense>
          </>
        ) : null}
      </body>
    </html>
  );
}
