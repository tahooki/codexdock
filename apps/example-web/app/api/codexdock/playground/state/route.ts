import { NextResponse } from "next/server";
import { codexdock, persistence } from "@/lib/codexdock";
import { ownerFromRequest } from "@/lib/owner";
import {
  getPostgresPlaygroundState,
  hasDatabaseConnection,
} from "@/lib/postgres-persistence";
import { withInvocationProgress } from "@codexdock/sdk";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const owner = ownerFromRequest(request);

  if (hasDatabaseConnection()) {
    return NextResponse.json({
      ok: true,
      ...(await getPostgresPlaygroundState(owner)),
    });
  }

  const status = await codexdock.getWorkerStatus(owner);
  const invocations = persistence.listInvocations
    ? await persistence.listInvocations(owner)
    : [];

  return NextResponse.json({
    ok: true,
    status,
    invocations: invocations
      .filter((invocation) => invocation.status !== "cancelled")
      .map((invocation) => withInvocationProgress(invocation)),
  });
}
