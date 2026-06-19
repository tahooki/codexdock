import { NextResponse } from "next/server";
import { persistence } from "@/lib/codexdock";
import { ownerFromRequest } from "@/lib/owner";
import {
  getPostgresPlaygroundActiveState,
  hasDatabaseConnection,
} from "@/lib/postgres-persistence";
import { withInvocationProgress } from "@codexdock/sdk";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const owner = ownerFromRequest(request);
  const invocationIds = await invocationIdsFromRequest(request);

  if (hasDatabaseConnection()) {
    return NextResponse.json({
      ok: true,
      ...(await getPostgresPlaygroundActiveState(owner, invocationIds)),
    });
  }

  const invocations = await Promise.all(
    invocationIds.map((invocationId) =>
      persistence.getInvocation(invocationId, owner),
    ),
  );

  return NextResponse.json({
    invocations: invocations
      .filter((invocation) => invocation !== null)
      .map((invocation) => withInvocationProgress(invocation)),
    ok: true,
  });
}

async function invocationIdsFromRequest(request: Request) {
  const body = await request.json().catch(() => null) as {
    invocationIds?: unknown;
  } | null;

  if (!body || !Array.isArray(body.invocationIds)) return [];

  const seen = new Set<string>();
  for (const value of body.invocationIds) {
    if (typeof value !== "string") continue;
    if (value.length === 0 || value.length > 128) continue;
    seen.add(value);
    if (seen.size >= 20) break;
  }

  return [...seen];
}
