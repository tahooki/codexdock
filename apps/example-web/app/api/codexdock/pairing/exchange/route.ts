import { NextResponse } from "next/server";
import { exchangePairingCode } from "@/lib/connection-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const input = (await request.json().catch(() => ({}))) as {
    code?: unknown;
    workerId?: unknown;
  };
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const workerId =
    typeof input.workerId === "string" && input.workerId.trim()
      ? input.workerId.trim()
      : "local-dev-worker";

  if (!code) {
    return NextResponse.json(
      { ok: false, error: { message: "Missing pairing code." } },
      { status: 400 },
    );
  }

  const result = await exchangePairingCode(code, workerId);
  if (!result) {
    return NextResponse.json(
      { ok: false, error: { message: "Pairing code is invalid, expired, or already used." } },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
