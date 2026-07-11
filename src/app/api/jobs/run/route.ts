import { NextResponse, type NextRequest } from "next/server";
import { env, isDemoMode } from "@/lib/env";

/**
 * Queue worker endpoint: claims due jobs and runs their handlers.
 * Invoked by Vercel Cron (after the tick enqueues) or manually.
 * Guarded by CRON_SECRET. Time-boxed batch: claims a few jobs per
 * invocation; remaining jobs are picked up by the next call.
 */
export const maxDuration = 300;

async function handle(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (isDemoMode) return NextResponse.json({ ran: 0, mode: "demo" });

  const { claimJobs, completeJob, failJob } = await import("@/lib/jobs/queue");
  const { runSyncJob } = await import("@/features/integrations/sync");

  const workerId = `vercel-${Math.random().toString(36).slice(2, 8)}`;
  const jobs = await claimJobs(workerId, 3);

  const results: Array<{ id: string; type: string; ok: boolean; error?: string }> = [];
  for (const job of jobs) {
    try {
      if (job.type.startsWith("sync.")) {
        await runSyncJob(job);
      } else {
        throw new Error(`no handler for job type ${job.type}`);
      }
      await completeJob(job.id);
      results.push({ id: job.id, type: job.type, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      await failJob(job.id, message, job.attempts);
      results.push({ id: job.id, type: job.type, ok: false, error: message });
    }
  }

  return NextResponse.json({ ran: results.length, results });
}

export const GET = handle;
export const POST = handle;
