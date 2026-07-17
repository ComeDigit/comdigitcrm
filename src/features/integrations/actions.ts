"use server";

import { revalidatePath } from "next/cache";
import { isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import { integrationConnections, integrationSecrets } from "@/db/schema";
import { authorize, AuthorizationError } from "@/lib/auth/authorize";
import { getPrincipal } from "@/lib/auth/principal";
import { encryptSecret } from "@/lib/crypto";
import { enqueue } from "@/lib/jobs/queue";

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
