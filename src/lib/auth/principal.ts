import "server-only";
import { getDb } from "@/lib/db";
import { isDemoMode } from "@/lib/env";
import type { Principal, Role } from "@/lib/auth/authorize";
import { demoOrg } from "@/features/demo-data/generator";
import { organizations } from "@/db/schema";

/**
 * Resolve the principal for the current request.
 *
 * Authentication has been removed by design: this deployment runs one
 * agency's own instance, not a multi-tenant SaaS with visitor logins, so
 * every request is treated as that agency's owner over its one live
 * organization — no sign-in required. `Role`/`Action`/`authorize()` are
 * unchanged and still gate every write (e.g. a future "client" viewer
 * role can still be layered on by assigning a scoped principal).
 * Demo mode (no Supabase configured) still uses the fixed demo principal.
 * Always resolves — there is no signed-out state anymore.
 */
export async function getPrincipal(): Promise<Principal> {
  if (isDemoMode) {
    return {
      userId: "demo-user",
      orgId: demoOrg.id,
      role: "agency_owner",
      workspaceIds: null,
    };
  }

  const org = await ensureDefaultOrg();
  return {
    userId: "owner",
    orgId: org.id,
    role: "agency_owner" as Role,
    workspaceIds: null,
  };
}

/** UUID-shaped strings only — "demo-user"/"owner" mean "no real actor". */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Safe value for nullable actor/creator columns — never write a non-UUID sentinel to a uuid column. */
export function actorIdOrNull(userId: string): string | null {
  return UUID_RE.test(userId) ? userId : null;
}

/** Finds the single live organization, creating it on the very first request against a fresh database. */
export async function ensureDefaultOrg() {
  const db = getDb();
  const existing = await db.query.organizations.findFirst();
  if (existing) return existing;

  const [created] = await db
    .insert(organizations)
    .values({ name: "ComeDigit Agency", slug: "comedigit-agency" })
    .onConflictDoUpdate({
      target: organizations.slug,
      set: { updatedAt: new Date() },
    })
    .returning();
  if (created) return created;

  // Extremely unlikely race: another request created it between the
  // select and the insert resolving. Re-read rather than fail.
  const retry = await db.query.organizations.findFirst();
  if (!retry) throw new Error("Failed to bootstrap the default organization.");
  return retry;
}
