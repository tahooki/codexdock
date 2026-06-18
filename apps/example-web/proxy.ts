import { NextResponse, type NextRequest } from "next/server";

const ownerCookieName = "codexdock_owner_id";
const ownerCookieMaxAge = 60 * 60 * 24 * 365;

export function proxy(request: NextRequest) {
  if (shouldSkipOwnerCookie(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const existingOwnerId = request.cookies.get(ownerCookieName)?.value;
  if (existingOwnerId) return NextResponse.next();

  const ownerId = `anon_${crypto.randomUUID()}`;
  const requestHeaders = new Headers(request.headers);
  const existingCookie = requestHeaders.get("cookie");
  requestHeaders.set(
    "cookie",
    existingCookie
      ? `${existingCookie}; ${ownerCookieName}=${encodeURIComponent(ownerId)}`
      : `${ownerCookieName}=${encodeURIComponent(ownerId)}`,
  );

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(ownerCookieName, ownerId, {
    httpOnly: true,
    maxAge: ownerCookieMaxAge,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

function shouldSkipOwnerCookie(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/api/codexdock/invoke" ||
    pathname.startsWith("/api/codexdock/invocations/") ||
    pathname.startsWith("/api/codexdock/worker/") ||
    pathname === "/api/codexdock/pairing/exchange"
  );
}

export const config = {
  matcher: ["/:path*"],
};
