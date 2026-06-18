import { NextResponse } from "next/server";
import { createPairingCode } from "@/lib/connection-store";
import {
  createOwnerId,
  isValidOwnerId,
  ownerCookieName,
  ownerCookieOptions,
  ownerFromId,
} from "@/lib/owner";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cookieOwnerId = cookieValue(request.headers.get("cookie"), ownerCookieName);
  const ownerId = isValidOwnerId(cookieOwnerId) ? cookieOwnerId : createOwnerId();
  const owner = ownerFromId(ownerId);
  const pairing = await createPairingCode(owner);
  const origin = new URL(request.url).origin;
  const command = `codexdock connect ${origin} --code ${pairing.code}`;
  const response = NextResponse.json({
    ok: true,
    owner,
    code: pairing.code,
    expiresAt: pairing.expiresAt,
    command,
  });

  if (!isValidOwnerId(cookieOwnerId)) {
    response.cookies.set(ownerCookieName, ownerId, ownerCookieOptions());
  }
  return response;
}

function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return undefined;
  const prefix = `${name}=`;
  const cookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : undefined;
}
