"use client";

import { useState } from "react";

export function CopyButton({ value }: { value: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyValue() {
    const copied = await copyText(value);
    setStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setStatus("idle"), 1600);
  }

  return (
    <button
      aria-label="Copy command"
      className="copyButton"
      onClick={copyValue}
      type="button"
    >
      {status === "copied" ? "Copied" : status === "failed" ? "Failed" : "Copy"}
    </button>
  );
}

async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the selection-based copy path for stricter browsers.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
