import "server-only";
import { isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";

/**
 * Read side of the audit trail (AUDIT_REPORT.md — Partial: "audit logs
 * write-only with no display UI"). auditLog itself has been written to by
 * mutation helpers for a while; this is the first query that reads it back.
 * No demo-mode data — the demo generator has never produced audit rows, so
 * demo mode just shows an empty/explanatory state on the page instead.
 */

export interface AuditEventRow {
  id: string;
  workspaceId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

const RECENT_EVENTS_LIMIT = 200;

export async function getRecentAuditEvents(orgId: string): Promise<AuditEventRow[]> {
  if (isDemoMode) return [];
  const db = getDb();
  const rows = await db.query.auditLog.findMany({
    where: (a, { eq }) => eq(a.orgId, orgId),
    orderBy: (a, { desc }) => desc(a.createdAt),
    limit: RECENT_EVENTS_LIMIT,
  });
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    actorId: r.actorId,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    before: r.before,
    after: r.after,
    createdAt: r.createdAt.toISOString(),
  }));
}

export { RECENT_EVENTS_LIMIT };
