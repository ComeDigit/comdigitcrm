import "server-only";
import { createSupabaseServer } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import type { Principal, Role } from "@/lib/auth/authorize";
import { demoOrg } from "@/features/demo-data/generator";

/**
 * Resolve the authenticated principal for the current request.
 * Demo mode: a fixed agency_owner principal over the demo org (there is
 * no auth backend to check). Live mode: session user + membership row.
 * Returns null when unauthenticated — callers turn that into a redirect
 * or a 401.
 */
export async function getPrincipal(): Promise<Principal | null> {
  if (isDemoMode) {
    return {
      userId: "demo-user",
      orgId: demoOrg.id,
      role: "agency_owner",
      workspaceIds: null,
    };
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
  if (!user) return null;

  const db = getDb();
  const membership = await db.query.memberships.findFirst({
    where: (m, { eq }) => eq(m.userId, user.id),
  });
  if (!membership) return null; // signed in but not onboarded

  return {
    userId: user.id,
    orgId: membership.orgId,
    role: membership.role as Role,
    workspaceIds: membership.workspaceIds ?? null,
  };
}
