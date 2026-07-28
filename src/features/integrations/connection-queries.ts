import "server-only";
import { isDemoMode } from "@/lib/env";

/**
 * Shared integration_connections reads. Settings needs every connection
 * across the whole org (one global list, labeled per client); the
 * per-client detail page needs just one workspace's — both go through
 * these two so the underlying query can never drift between the two views.
 */

export async function getOrgConnections(orgId: string) {
  if (isDemoMode) return [];
  const { getDb } = await import("@/lib/db");
  return getDb().query.integrationConnections.findMany({
    where: (c, { eq }) => eq(c.orgId, orgId),
  });
}

export async function getWorkspaceConnections(orgId: string, workspaceId: string) {
  if (isDemoMode) return [];
  const { getDb } = await import("@/lib/db");
  return getDb().query.integrationConnections.findMany({
    where: (c, { eq, and }) => and(eq(c.orgId, orgId), eq(c.workspaceId, workspaceId)),
  });
}
