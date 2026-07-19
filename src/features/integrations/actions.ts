"use server";

import { revalidatePath } from "next/cache";
import { env, isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import { integrationConnections, integrationSecrets, workspaces, auditLog } from "@/db/schema";
import { authorize, AuthorizationError } from "@/lib/auth/authorize";
import { getPrincipal, actorIdOrNull } from "@/lib/auth/principal";
import { encryptSecret } from "@/lib/crypto";
import { checkMetaTokenHealth, type MetaTokenHealth } from "./meta";

/** Same slugify as features/crm/actions.ts's createWorkspace — duplicated
 *  rather than imported so this file doesn't reach across features for one
 *  small pure function. Keep the two in sync if the scheme ever changes. */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "client"
  );
}

/**
 * Manual-credential connect path — bypasses the OAuth dialog entirely.
 * Useful when the provider app's domain/redirect config isn't cooperating
 * yet, or when using a System User token that never expires. Two steps:
 * 1. previewMetaAccessToken — verify the token and list every ad account
 *    it can see (a Business often has several).
 * 2. connectMetaAccounts — save the ones the user picked, each mapped to
 *    whichever client workspace it belongs to.
 * Every DB/network call is wrapped so an unexpected failure returns a
 * friendly error instead of crashing the page.
 */

export interface ActionResult {
  error?: string;
  ok?: boolean;
}

export interface MetaAccountPreview {
  accountId: string;
  name: string;
  currency: string;
  timezone: string;
}

export interface PreviewResult {
  error?: string;
  accounts?: MetaAccountPreview[];
}

export interface MetaAccountSelection extends MetaAccountPreview {
  workspaceId: string;
}

const GRAPH = "https://graph.facebook.com/v21.0";

/** Shared Graph-API "list ad accounts this token can see" call — used both
 *  by the paste-a-token flow and the shared agency-token flow below. */
async function listMetaAdAccounts(accessToken: string): Promise<PreviewResult> {
  try {
    const res = await fetch(
      `${GRAPH}/me/adaccounts?fields=account_id,name,currency,timezone_name&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) {
      return {
        error:
          "Meta rejected this token — check it hasn't expired and includes the ads_read permission.",
      };
    }
    const body = (await res.json()) as {
      data?: Array<{ account_id: string; name: string; currency: string; timezone_name: string }>;
    };
    if (!body.data || body.data.length === 0) {
      return { error: "This token has no ad accounts attached to it." };
    }
    return {
      accounts: body.data.map((a) => ({
        accountId: a.account_id,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone_name,
      })),
    };
  } catch {
    return { error: "Could not reach Meta right now. Try again in a moment." };
  }
}

export async function previewMetaAccessToken(rawToken: string): Promise<PreviewResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to save real connections." };
  }
  const accessToken = rawToken.trim();
  if (accessToken.length < 20) {
    return { error: "That doesn't look like a valid access token." };
  }

  try {
    const principal = await getPrincipal();
    authorize(principal, "connections.manage");
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    return { error: "Could not verify permissions right now." };
  }

  return listMetaAdAccounts(accessToken);
}

/**
 * Agency-wide token variant — sources the token from the server-only
 * META_USER_TOKEN env var instead of a pasted value, so nothing secret ever
 * reaches the browser. Used for connecting client ad accounts under the one
 * shared agency token (coexists with per-client paste-a-token connections).
 */
export async function previewAgencyMetaAccounts(): Promise<PreviewResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to save real connections." };
  }
  if (!env.META_USER_TOKEN) {
    return { error: "META_USER_TOKEN isn't set in this environment yet." };
  }

  try {
    const principal = await getPrincipal();
    authorize(principal, "connections.manage");
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    return { error: "Could not verify permissions right now." };
  }

  return listMetaAdAccounts(env.META_USER_TOKEN);
}

export async function connectMetaAccounts(
  rawToken: string,
  selections: MetaAccountSelection[],
): Promise<ActionResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to save real connections." };
  }
  const accessToken = rawToken.trim();
  if (accessToken.length < 20) {
    return { error: "That doesn't look like a valid access token." };
  }
  if (selections.length === 0) {
    return { error: "Pick at least one ad account." };
  }
  if (selections.some((s) => !s.workspaceId)) {
    return { error: "Pick a client workspace for every selected ad account." };
  }

  try {
    const principal = await getPrincipal();
    const db = getDb();

    for (const sel of selections) {
      authorize(principal, "connections.manage", sel.workspaceId);

      const [connection] = await db
        .insert(integrationConnections)
        .values({
          orgId: principal.orgId,
          workspaceId: sel.workspaceId,
          provider: "meta",
          externalAccountId: sel.accountId,
          displayName: sel.name,
          status: "active",
          grantedScopes: ["ads_read"],
          currencyCode: sel.currency,
          timezone: sel.timezone,
        })
        .onConflictDoUpdate({
          target: [
            integrationConnections.workspaceId,
            integrationConnections.provider,
            integrationConnections.externalAccountId,
          ],
          set: { status: "active", lastError: null, displayName: sel.name },
        })
        .returning();

      await db
        .insert(integrationSecrets)
        .values({
          connectionId: connection.id,
          encryptedPayload: encryptSecret(JSON.stringify({ accessToken })),
        })
        .onConflictDoUpdate({
          target: integrationSecrets.connectionId,
          set: {
            encryptedPayload: encryptSecret(JSON.stringify({ accessToken })),
            rotatedAt: new Date(),
          },
        });

      // Meta reporting is on-demand now (see features/integrations/meta-live.ts)
      // — no background sync job to enqueue. The Meta Ads page and share
      // links pull live from Graph the moment someone opens them.
    }
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return { error: "Not allowed for one of the selected workspaces." };
    }
    return {
      error:
        e instanceof Error
          ? `Could not save this connection: ${e.message}`
          : "Unknown error while connecting.",
    };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export interface AgencyTokenHealthResult extends MetaTokenHealth {
  configured: boolean;
}

/**
 * Health check for the shared agency token — used by the Settings page to
 * show a "reconnect soon" banner before META_USER_TOKEN's ~60-day expiry
 * catches anyone by surprise. Read-only; safe to call on every page render.
 */
export async function checkAgencyMetaTokenHealth(): Promise<AgencyTokenHealthResult> {
  if (isDemoMode || !env.META_USER_TOKEN) {
    return {
      configured: false,
      valid: false,
      expiresAt: null,
      daysUntilExpiry: null,
      scopes: [],
    };
  }
  const health = await checkMetaTokenHealth(env.META_USER_TOKEN, env.META_APP_ID, env.META_APP_SECRET);
  return { configured: true, ...health };
}

/**
 * Connects ad accounts under the shared agency token. Deliberately does NOT
 * write an integrationSecrets row — leaving a connection's secret empty is
 * what makes sync.ts fall back to env.META_USER_TOKEN at sync time. If this
 * client is later given its own dedicated token via connectMetaAccounts,
 * that per-connection secret takes precedence automatically.
 */
export async function connectAgencyMetaAccounts(
  selections: MetaAccountSelection[],
): Promise<ActionResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to save real connections." };
  }
  if (!env.META_USER_TOKEN) {
    return { error: "META_USER_TOKEN isn't set in this environment yet." };
  }
  if (selections.length === 0) {
    return { error: "Pick at least one ad account." };
  }
  if (selections.some((s) => !s.workspaceId)) {
    return { error: "Pick a client workspace for every selected ad account." };
  }

  try {
    const principal = await getPrincipal();
    const db = getDb();

    for (const sel of selections) {
      authorize(principal, "connections.manage", sel.workspaceId);

      // Meta reporting is on-demand now (see features/integrations/meta-live.ts)
      // — no background sync job to enqueue, so the inserted row's id isn't
      // needed here.
      await db
        .insert(integrationConnections)
        .values({
          orgId: principal.orgId,
          workspaceId: sel.workspaceId,
          provider: "meta",
          externalAccountId: sel.accountId,
          displayName: sel.name,
          status: "active",
          grantedScopes: ["ads_read"],
          currencyCode: sel.currency,
          timezone: sel.timezone,
        })
        .onConflictDoUpdate({
          target: [
            integrationConnections.workspaceId,
            integrationConnections.provider,
            integrationConnections.externalAccountId,
          ],
          set: { status: "active", lastError: null, displayName: sel.name },
        });
    }
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return { error: "Not allowed for one of the selected workspaces." };
    }
    return {
      error:
        e instanceof Error
          ? `Could not save this connection: ${e.message}`
          : "Unknown error while connecting.",
    };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export interface AutoProvisionResult {
  error?: string;
  ok?: boolean;
  createdWorkspaces?: number;
  connectedAccounts?: number;
  skippedAccounts?: number;
}

/**
 * Auto-provisioning variant of the agency-token flow above: instead of an
 * admin hand-picking a client workspace per ad account, this fetches every
 * ad account the agency token can see and, for each one not already
 * connected to some workspace in this org, creates a brand-new client
 * workspace named after the ad account (Meta is the source of truth for
 * the client list, not the other way round) and connects it — one
 * workspace per ad account. Accounts already connected somewhere (matched
 * by externalAccountId, not by name) are left untouched, so this is safe
 * to re-run any time a new ad account shows up in the Business portfolio —
 * it only ever adds, never duplicates or reassigns.
 */
export async function autoProvisionAgencyMetaAccounts(): Promise<AutoProvisionResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to save real connections." };
  }
  if (!env.META_USER_TOKEN) {
    return { error: "META_USER_TOKEN isn't set in this environment yet." };
  }

  const preview = await listMetaAdAccounts(env.META_USER_TOKEN);
  if (preview.error || !preview.accounts) {
    return { error: preview.error ?? "Could not list ad accounts." };
  }

  let createdWorkspaces = 0;
  let connectedAccounts = 0;
  let skippedAccounts = 0;

  try {
    const principal = await getPrincipal();
    authorize(principal, "workspace.manage");
    authorize(principal, "connections.manage");
    const db = getDb();

    for (const account of preview.accounts) {
      // Already connected to some workspace in this org? Leave it alone —
      // this is what makes re-running auto-provision safe rather than
      // spawning a duplicate workspace every time it's clicked.
      const existing = await db.query.integrationConnections.findFirst({
        where: (c, { and, eq }) =>
          and(
            eq(c.orgId, principal.orgId),
            eq(c.provider, "meta"),
            eq(c.externalAccountId, account.accountId),
          ),
      });
      if (existing) {
        skippedAccounts++;
        continue;
      }

      const baseSlug = slugify(account.name);
      let slug = baseSlug;
      for (let i = 2; i <= 20; i++) {
        const clash = await db.query.workspaces.findFirst({
          where: (w, { and, eq }) => and(eq(w.orgId, principal.orgId), eq(w.slug, slug)),
        });
        if (!clash) break;
        slug = `${baseSlug}-${i}`;
      }

      const [workspace] = await db
        .insert(workspaces)
        .values({
          orgId: principal.orgId,
          name: account.name,
          slug,
          currencyCode: account.currency || "INR",
          timezone: account.timezone || "Asia/Kolkata",
        })
        .returning({ id: workspaces.id });
      createdWorkspaces++;

      await db.insert(auditLog).values({
        orgId: principal.orgId,
        workspaceId: workspace.id,
        actorId: actorIdOrNull(principal.userId),
        action: "workspace.create",
        resourceType: "workspace",
        resourceId: workspace.id,
        after: { name: account.name, source: "meta_auto_provision", accountId: account.accountId },
      });

      await db
        .insert(integrationConnections)
        .values({
          orgId: principal.orgId,
          workspaceId: workspace.id,
          provider: "meta",
          externalAccountId: account.accountId,
          displayName: account.name,
          status: "active",
          grantedScopes: ["ads_read"],
          currencyCode: account.currency,
          timezone: account.timezone,
        })
        .onConflictDoUpdate({
          target: [
            integrationConnections.workspaceId,
            integrationConnections.provider,
            integrationConnections.externalAccountId,
          ],
          set: { status: "active", lastError: null, displayName: account.name },
        });
      connectedAccounts++;
    }
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    return {
      error:
        e instanceof Error
          ? `Stopped partway through: ${e.message}. Anything already created is safe — re-run to pick up the rest.`
          : "Unknown error while auto-provisioning.",
    };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/clients");
  revalidatePath("/dashboard");

  return { ok: true, createdWorkspaces, connectedAccounts, skippedAccounts };
}
