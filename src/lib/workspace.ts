import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import { workspaces } from "@/db/schema";
import { demoWorkspaces } from "@/features/demo-data/generator";
import { getPrincipal } from "@/lib/auth/principal";

/**
 * Active client-brand resolution. Demo mode always uses the fixed demo
 * workspace list. Live mode reads the real workspaces for the (single,
 * login-free) organization, auto-creating one on the very first request
 * against a brand-new database so the app never renders an empty switcher.
 */

async function liveWorkspaceList(): Promise<Array<{ id: string; name: string }>> {
  const principal = await getPrincipal();
  if (!principal) return [];
  const db = getDb();
  // Archived (soft-deleted) clients must disappear from the switcher too —
  // otherwise "delete client" only hides a workspace from the roster page
  // while every other dashboard route stays fully reachable for it via this
  // dropdown. Suspended clients are NOT filtered here: suspend only blocks
  // that client's own portal login: the agency's internal dashboard access
  // to a suspended client's data is untouched by design.
  const rows = await db.query.workspaces.findMany({
    where: (w, { eq, and, isNull }) => and(eq(w.orgId, principal.orgId), isNull(w.archivedAt)),
  });
  if (rows.length > 0) return rows.map((w) => ({ id: w.id, name: w.name }));

  const [created] = await db
    .insert(workspaces)
    .values({ orgId: principal.orgId, name: "My First Client", slug: "my-first-client" })
    .onConflictDoNothing()
    .returning();
  if (created) return [{ id: created.id, name: created.name }];

  // Race with another concurrent bootstrap request — re-read. Same
  // archived-filter as above; onConflictDoNothing can no-op against an
  // archived workspace that happens to share the bootstrap slug.
  const retry = await db.query.workspaces.findMany({
    where: (w, { eq, and, isNull }) => and(eq(w.orgId, principal.orgId), isNull(w.archivedAt)),
  });
  return retry.map((w) => ({ id: w.id, name: w.name }));
}

/** Request-memoized so every page/Topbar pairing hits the DB at most once per render. */
const workspaceList = cache(async (): Promise<Array<{ id: string; name: string }>> => {
  return isDemoMode
    ? demoWorkspaces.map((w) => ({ id: w.id, name: w.name }))
    : liveWorkspaceList();
});

export async function getActiveWorkspaceId(): Promise<string> {
  const store = await cookies();
  const requested = store.get("ws")?.value;
  const list = await workspaceList();
  const valid = Boolean(requested) && list.some((w) => w.id === requested);
  return valid ? (requested as string) : (list[0]?.id ?? "");
}

export async function getWorkspaceName(id: string): Promise<string> {
  const list = await workspaceList();
  return list.find((w) => w.id === id)?.name ?? "Workspace";
}

export async function listActiveWorkspaces(): Promise<Array<{ id: string; name: string }>> {
  return workspaceList();
}
