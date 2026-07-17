"use server";

import { createHash, randomBytes } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import { shareLinks } from "@/db/schema";
import { authorize, AuthorizationError } from "@/lib/auth/authorize";
import { getPrincipal } from "@/lib/auth/principal";
import type { DemoProvider } from "@/features/demo-data/generator";

/**
 * Public, no-login share links — the third access tier alongside the
 * internal team dashboard and the per-client login-free dashboard itself.
 * A share link exposes exactly one workspace's one provider report at
 * /share/:provider/:token, with no navigation to any other workspace or
 * page. The raw token is generated here and returned exactly once; only
 * its SHA-256 hash is ever persisted (see db/schema/ops.ts), so a database
 * leak alone can never be used to mint a working share URL.
 */

export interface ActionResult {
  error?: string;
  ok?: boolean;
}

export interface ShareLinkSummary {
  id: string;
  workspaceId: string;
  provider: string;
  label: string | null;
  createdAt: string;
  lastViewedAt: string | null;
  revokedAt: string | null;
}

export interface CreateShareLinkResult extends ActionResult {
  /** Raw token — shown once here, never retrievable again after this call. */
  token?: string;
  url?: string;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createShareLink(
  workspaceId: string,
  provider: DemoProvider,
  label?: string,
): Promise<CreateShareLinkResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to create real share links." };
  }
  try {
    const principal = await getPrincipal();
    authorize(principal, "share_links.manage", workspaceId);

    const db = getDb();
    const raw = randomBytes(24).toString("base64url");
    await db.insert(shareLinks).values({
      orgId: principal.orgId,
      workspaceId,
      provider,
      label: label?.trim() || null,
      tokenHash: hashToken(raw),
    });

    revalidatePath("/dashboard/settings");
    return { ok: true, token: raw, url: `/share/${provider}/${raw}` };
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    return {
      error: e instanceof Error ? `Could not create share link: ${e.message}` : "Unknown error.",
    };
  }
}

export async function listShareLinks(workspaceId: string): Promise<ShareLinkSummary[]> {
  if (isDemoMode) return [];
  try {
    const principal = await getPrincipal();
    authorize(principal, "share_links.manage", workspaceId);
  } catch {
    return [];
  }

  const db = getDb();
  const rows = await db.query.shareLinks.findMany({
    where: (s, { eq: eqOp }) => eqOp(s.workspaceId, workspaceId),
    orderBy: (s, { desc }) => [desc(s.createdAt)],
  });
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    provider: r.provider,
    label: r.label,
    createdAt: r.createdAt.toISOString(),
    lastViewedAt: r.lastViewedAt ? r.lastViewedAt.toISOString() : null,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  }));
}

export async function revokeShareLink(id: string, workspaceId: string): Promise<ActionResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to manage real share links." };
  }
  try {
    const principal = await getPrincipal();
    authorize(principal, "share_links.manage", workspaceId);

    const db = getDb();
    await db
      .update(shareLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(shareLinks.id, id), eq(shareLinks.workspaceId, workspaceId)));

    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    return {
      error: e instanceof Error ? `Could not revoke share link: ${e.message}` : "Unknown error.",
    };
  }
}

/**
 * Public resolver for the /share/:provider/:token route. Deliberately does
 * NOT call authorize() — that's the entire point of a share link. Returns
 * null for anything that isn't an active, matching, non-revoked link so
 * the route can render one generic "this link isn't available" page
 * without distinguishing "wrong token" from "revoked" to a stranger.
 */
export async function resolveShareLink(
  provider: DemoProvider,
  rawToken: string,
): Promise<{ workspaceId: string; label: string | null } | null> {
  if (isDemoMode || !rawToken || rawToken.length < 10) return null;

  const db = getDb();
  const row = await db.query.shareLinks.findFirst({
    where: (s, { eq: eqOp, and: andOp }) =>
      andOp(eqOp(s.tokenHash, hashToken(rawToken)), eqOp(s.provider, provider), isNull(s.revokedAt)),
  });
  if (!row) return null;

  // Best-effort view tracking — never blocks rendering the report.
  void db
    .update(shareLinks)
    .set({ lastViewedAt: new Date() })
    .where(eq(shareLinks.id, row.id))
    .catch(() => {});

  return { workspaceId: row.workspaceId, label: row.label };
}
