"use client";

export type GoogleAnalyticsEventParams = Record<string, boolean | number | string | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackGoogleAnalyticsEvent(
  eventName: string,
  params: GoogleAnalyticsEventParams = {},
) {
  if (typeof window === "undefined") return;

  window.dataLayer = window.dataLayer ?? [];
  window.gtag =
    window.gtag ??
    function gtag() {
      window.dataLayer?.push(arguments);
    };

  window.gtag("event", eventName, cleanParams(params));
}

function cleanParams(params: GoogleAnalyticsEventParams) {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, boolean | number | string] =>
      entry[1] !== undefined,
    ),
  );
}
