import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { CodexDockOwner } from "@codexdock/sdk";

export const ownerCookieName = "codexdock_owner_id";
export const ownerCookieMaxAge = 60 * 60 * 24 * 365;

export function createOwnerId() {
  return `anon_${randomUUID()}`;
}

export function ownerFromId(ownerId: string): CodexDockOwner {
  return { ownerKind: "user", ownerId };
}

export function isValidOwnerId(value: string | undefined): value is string {
  return !!value && /^[a-zA-Z0-9_.:-]{8,200}$/.test(value);
}

export function ownerFromCookieHeader(cookieHeader: string | null): CodexDockOwner | null {
  if (!cookieHeader) return null;
  const cookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${ownerCookieName}=`));
  if (!cookie) return null;

  const ownerId = decodeURIComponent(cookie.slice(ownerCookieName.length + 1));
  return isValidOwnerId(ownerId) ? ownerFromId(ownerId) : null;
}

export function ownerFromRequest(request: Request): CodexDockOwner {
  return ownerFromCookieHeader(request.headers.get("cookie")) ?? {
    ownerKind: "system",
    ownerId: "local-dev",
  };
}

export async function getBrowserOwner(): Promise<CodexDockOwner> {
  const cookieStore = await cookies();
  const ownerId = cookieStore.get(ownerCookieName)?.value;
  return ownerFromId(isValidOwnerId(ownerId) ? ownerId : createOwnerId());
}

export function ownerCookieOptions() {
  return {
    httpOnly: true,
    maxAge: ownerCookieMaxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
