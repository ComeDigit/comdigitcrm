import "server-only";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { jobQueue } from "@/db/schema";

/**
 * Postgres-backed job queue (FOR UPDATE SKIP LOCKED pattern).
 * Producers: Vercel Cron tick, webhooks, user actions.
 * Consumers: Supabase Edge Function workers / route-handler workers.
 * Failure policy: exponential backoff with jitter up to maxAttempts,
 * then status=failed (which feeds the API-failure alert automation).
 */

export interface EnqueueInput {
  type: string;
  orgId: string;
  workspaceId?: string;
  connectionId?: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  dedupeKey?: string;
}

export async function enqueue(input: EnqueueInput): Promise<void> {
  const db = getDb();
  await db
    .insert(jobQueue)
    .values({
      type: input.type,
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      payload: input.payload ?? {},
      runAt: input.runAt ?? new Date(),
      dedupeKey: input.dedupeKey,
    })
    .onConflictDoNothing(); // dedupe on (dedupe_key) where queued
}

export interface ClaimedJob {
  id: string;
  type: string;
  orgId: string;
  workspaceId: string | null;
  connectionId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Claim up to `limit` due jobs atomically. Safe under concurrent workers. */
export async function claimJobs(
  workerId: string,
  limit = 5,
): Promise<ClaimedJob[]> {
  const db = getDb();
  const rows = await db.execute(sql`
    update job_queue set
      status = 'running',
      locked_by = ${workerId},
      locked_at = now(),
      attempts = attempts + 1
    where id in (
      select id from job_queue
      where status = 'queued' and run_at <= now()
      order by run_at asc
      limit ${limit}
      for update skip locked
    )
    returning id, type, org_id, workspace_id, connection_id, payload, attempts
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    type: r.type as string,
    orgId: r.org_id as string,
    workspaceId: (r.workspace_id as string) ?? null,
    connectionId: (r.connection_id as string) ?? null,
    payload: (r.payload as Record<string, unknown>) ?? {},
    attempts: r.attempts as number,
  }));
}

export async function completeJob(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(jobQueue)
    .set({ status: "succeeded", finishedAt: new Date(), lockedBy: null })
    .where(eq(jobQueue.id, id));
}

export async function failJob(
  id: string,
  error: string,
  attempts: number,
  maxAttempts = 5,
): Promise<void> {
  const db = getDb();
  if (attempts >= maxAttempts) {
    await db
      .update(jobQueue)
      .set({ status: "failed", lastError: error, finishedAt: new Date() })
      .where(eq(jobQueue.id, id));
    return;
  }
  // Exponential backoff with jitter: 2^attempts minutes ± 20%.
  const baseMs = 2 ** attempts * 60_000;
  const jitter = 0.8 + Math.random() * 0.4;
  await db
    .update(jobQueue)
    .set({
      status: "queued",
      lastError: error,
      lockedBy: null,
      runAt: new Date(Date.now() + baseMs * jitter),
    })
    .where(eq(jobQueue.id, id));
}

/** List due job count (used by the cron tick for observability). */
export async function dueJobCount(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobQueue)
    .where(and(eq(jobQueue.status, "queued"), lte(jobQueue.runAt, new Date())))
    .orderBy(asc(jobQueue.runAt));
  return row?.count ?? 0;
}
