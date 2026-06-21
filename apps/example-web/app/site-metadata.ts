import type { Metadata } from "next";

const siteName = "CodexDock";

export function createPageMetadata({
  description,
  path,
  title,
}: {
  description: string;
  path: string;
  title: string;
}): Metadata {
  const fullTitle = `${title} | ${siteName}`;

  return {
    title: {
      absolute: fullTitle,
    },
    description,
    alternates: {
      canonical: path,
    },
    openGraph: {
      title: fullTitle,
      description,
      url: path,
      siteName,
      type: "website",
    },
    twitter: {
      card: "summary",
      title: fullTitle,
      description,
    },
  };
}
