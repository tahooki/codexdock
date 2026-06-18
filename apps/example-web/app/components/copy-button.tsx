"use client";

import { useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      aria-label="Copy command"
      className="copyButton"
      onClick={copyValue}
      type="button"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
