import { NextResponse } from "next/server";
import { codexdock } from "@/lib/codexdock";
import { ownerFromRequest } from "@/lib/owner";
import {
  getPostgresPlaygroundStatus,
  hasDatabaseConnection,
} from "@/lib/postgres-persistence";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const owner = ownerFromRequest(request);

  return NextResponse.json({
    ok: true,
    status: hasDatabaseConnection()
      ? await getPostgresPlaygroundStatus(owner)
      : await codexdock.getWorkerStatus(owner),
  });
}
