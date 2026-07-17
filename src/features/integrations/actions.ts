"use server";

import { revalidatePath } from "next/cache";
import { env, isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import { integrationConnections, integrationSecrets } from "@/db/schema";
import { authorize, AuthorizationError } from "@/lib/auth/authorize";
import { getPrincipal } from "@/lib/auth/principal";
import { encryptSecret } from "@/lib/crypto";
import { enqueue } from "@/lib/jobs/queue";
import { checkMetaTokenHealth, type MetaTokenHealth } from "./meta";

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

      await enqueue({
        type: "sync.meta.insights",
        orgId: principal.orgId,
        workspaceId: sel.workspaceId,
        connectionId: connection.id,
        payload: { backfillDays: 90 },
        dedupeKey: `sync:${connection.id}:initial`,
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

      await enqueue({
        type: "sync.meta.insights",
        orgId: principal.orgId,
        workspaceId: sel.workspaceId,
        connectionId: connection.id,
        payload: { backfillDays: 90 },
        dedupeKey: `sync:${connection.id}:initial`,
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
