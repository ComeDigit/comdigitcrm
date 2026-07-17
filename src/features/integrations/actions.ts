"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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
 * yet, or when using a System User token that never expires. The pasted
 * token must already carry the right permission (ads_read for Meta) on
 * the account; this action verifies that by calling the provider API
 * directly before saving anything.
 */

export interface ActionResult {
  error?: string;
  ok?: boolean;
}

const GRAPH = "https://graph.facebook.com/v21.0";

const metaTokenSchema = z.object({
  workspaceId: z.string().uuid("Pick a client workspace"),
  accessToken: z.string().trim().min(20, "That doesn't look like a valid access token"),
});

export async function connectMetaWithToken(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to save real connections." };
  }

  const parsed = metaTokenSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    accessToken: formData.get("accessToken"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const principal = await getPrincipal();
  try {
    authorize(principal, "connections.manage", parsed.data.workspaceId);
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    throw e;
  }

  // Verify the token against Meta's own API before storing anything —
  // never trust a pasted credential blind.
  let accountsRes: Response;
  try {
    accountsRes = await fetch(
      `${GRAPH}/me/adaccounts?fields=account_id,name,currency,timezone_name&access_token=${encodeURIComponent(parsed.data.accessToken)}`,
    );
  } catch {
    return { error: "Could not reach Meta right now. Try again in a moment." };
  }
  if (!accountsRes.ok) {
    return {
      error:
        "Meta rejected this token — check it hasn't expired and includes the ads_read permission.",
    };
  }
  const accounts = (await accountsRes.json()) as {
    data?: Array<{ account_id: string; name: string; currency: string; timezone_name: string }>;
  };
  const account = accounts.data?.[0];
  if (!account) {
    return { error: "This token has no ad accounts attached to it." };
  }

  const db = getDb();
  const [connection] = await db
    .insert(integrationConnections)
    .values({
      orgId: principal.orgId,
      workspaceId: parsed.data.workspaceId,
      provider: "meta",
      externalAccountId: account.account_id,
      displayName: account.name,
      status: "active",
      grantedScopes: ["ads_read"],
      currencyCode: account.currency,
      timezone: account.timezone_name,
    })
    .onConflictDoUpdate({
      target: [
        integrationConnections.workspaceId,
        integrationConnections.provider,
        integrationConnections.externalAccountId,
      ],
      set: { status: "active", lastError: null },
    })
    .returning();

  await db
    .insert(integrationSecrets)
    .values({
      connectionId: connection.id,
      encryptedPayload: encryptSecret(JSON.stringify({ accessToken: parsed.data.accessToken })),
    })
    .onConflictDoUpdate({
      target: integrationSecrets.connectionId,
      set: {
        encryptedPayload: encryptSecret(JSON.stringify({ accessToken: parsed.data.accessToken })),
        rotatedAt: new Date(),
      },
    });

  await enqueue({
    type: "sync.meta.insights",
    orgId: principal.orgId,
    workspaceId: parsed.data.workspaceId,
    connectionId: connection.id,
    payload: { backfillDays: 90 },
    dedupeKey: `sync:${connection.id}:initial`,
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}
