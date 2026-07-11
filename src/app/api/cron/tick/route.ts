import { NextResponse, type NextRequest } from "next/server";
import { env, isDemoMode } from "@/lib/env";

/**
 * Vercel Cron tick. Enqueues due sync jobs for active connections;
 * the /api/jobs/run worker drains the queue. Guarded by CRON_SECRET
 * (Vercel sends it as the Authorization bearer automatically).
 * Vercel Cron invokes with GET; POST kept for manual triggering.
 */
async function handle(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (isDemoMode) {
    return NextResponse.json({ enqueued: 0, mode: "demo" });
  }

  // Lazy import: keeps demo mode from touching the database layer.
  const { enqueue } = await import("@/lib/jobs/queue");
  const { getDb } = await import("@/lib/db");
  const { integrationConnections } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  const db = getDb();
  const connections = await db
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.status, "active"));

  await Promise.all(
    connections.map((c) =>
      enqueue({
        type: `sync.${c.provider}.insights`,
        orgId: c.orgId,
        workspaceId: c.workspaceId,
        connectionId: c.id,
        dedupeKey: `sync:${c.id}:insights`,
      }),
    ),
  );

  return NextResponse.json({ enqueued: connections.length });
}

export const GET = handle;
export const POST = handle;
