"use server";

import { revalidatePath } from "next/cache";
import { env, isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import { integrationConnections, integrationSecrets, workspaces, auditLog } from "@/db/schema";
import { authorize, AuthorizationError } from "@/lib/auth/authorize";
import { getPrincipal, actorIdOrNull } from "@/lib/auth/principal";
import { encryptSecret } from "@/lib/crypto";
import { checkMetaTokenHealth, type MetaTokenHealth } from "./meta";
import { verifyShopifyCredentials, type ShopifyShopInfo } from "./shopify";
import { refreshAccessToken, listLinkedClientAccounts } from "./google-ads";
import { fetchAuthorizedAdvertiserIds, fetchAdvertiserInfo } from "./tiktok";

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

/**
 * Shopify connect — a "custom app" per store (created directly in the
 * merchant's own Shopify admin), not a public OAuth app. This is the
 * Shopify-recommended approach for an agency integrating a known, bounded
 * list of client stores: no App Store review, and the Admin API access
 * token is available the moment the custom app is installed. Two steps,
 * mirroring the Meta manual-token flow exactly: preview (verify the
 * credentials work, show the shop name back) → connect (save it).
 */

function normalizeShopDomain(input: string): string | null {
  let v = input.trim().toLowerCase();
  v = v.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!v) return null;
  if (!v.includes(".")) v = `${v}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(v)) {
    return null;
  }
  return v;
}

export interface ShopifyPreviewResult {
  error?: string;
  shop?: ShopifyShopInfo;
}

export async function previewShopifyStore(
  shopDomainRaw: string,
  accessToken: string,
): Promise<ShopifyPreviewResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to save real connections." };
  }
  const shopDomain = normalizeShopDomain(shopDomainRaw);
  if (!shopDomain) {
    return { error: "Enter a valid shop domain, e.g. yourstore.myshopify.com" };
  }
  const token = accessToken.trim();
  if (token.length < 10) {
    return { error: "That doesn't look like a valid Admin API access token." };
  }

  try {
    const principal = await getPrincipal();
    authorize(principal, "connections.manage");
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    return { error: "Could not verify permissions right now." };
  }

  try {
    const shop = await verifyShopifyCredentials(shopDomain, token);
    return { shop: { ...shop, domain: shopDomain } };
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? e.message
          : "Could not reach Shopify with these credentials.",
    };
  }
}

export async function connectShopifyStore(
  workspaceId: string,
  shopDomainRaw: string,
  accessToken: string,
): Promise<ActionResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to save real connections." };
  }
  const shopDomain = normalizeShopDomain(shopDomainRaw);
  if (!shopDomain) {
    return { error: "Enter a valid shop domain, e.g. yourstore.myshopify.com" };
  }
  const token = accessToken.trim();
  if (token.length < 10) {
    return { error: "That doesn't look like a valid Admin API access token." };
  }

  try {
    const principal = await getPrincipal();
    authorize(principal, "connections.manage", workspaceId);

    const shop = await verifyShopifyCredentials(shopDomain, token);
    const db = getDb();

    const [connection] = await db
      .insert(integrationConnections)
      .values({
        orgId: principal.orgId,
        workspaceId,
        provider: "shopify",
        externalAccountId: shopDomain,
        displayName: shop.name,
        status: "active",
        grantedScopes: ["read_orders", "read_customers"],
        currencyCode: shop.currency,
        timezone: shop.timezone,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.workspaceId,
          integrationConnections.provider,
          integrationConnections.externalAccountId,
        ],
        set: {
          status: "active",
          lastError: null,
          displayName: shop.name,
          currencyCode: shop.currency,
          timezone: shop.timezone,
        },
      })
      .returning();

    await db
      .insert(integrationSecrets)
      .values({
        connectionId: connection.id,
        encryptedPayload: encryptSecret(JSON.stringify({ accessToken: token })),
      })
      .onConflictDoUpdate({
        target: integrationSecrets.connectionId,
        set: {
          encryptedPayload: encryptSecret(JSON.stringify({ accessToken: token })),
          rotatedAt: new Date(),
        },
      });
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    return {
      error:
        e instanceof Error
          ? `Could not connect this store: ${e.message}`
          : "Unknown error while connecting.",
    };
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

/**
 * Google Ads agency-wide connect — mirrors the Meta agency-token flow
 * (previewAgencyMetaAccounts/connectAgencyMetaAccounts), but sourced from
 * GOOGLE_ADS_REFRESH_TOKEN + GOOGLE_ADS_LOGIN_CUSTOMER_ID (the agency's own
 * MCC) instead of a single long-lived token. This is the recommended path
 * for connecting client accounts: it needs the admin to mint ONE refresh
 * token (via Google's OAuth Playground, or by running this app's own
 * /api/integrations/google_ads/start once and copying the result), then
 * every client linked under the MCC can be connected just by picking it
 * from a list — no per-client OAuth consent needed.
 */

export interface GoogleAdsAccountPreview {
  customerId: string;
  name: string;
  currency: string;
  timezone: string;
}

export interface GoogleAdsAccountSelection extends GoogleAdsAccountPreview {
  workspaceId: string;
}

export async function previewAgencyGoogleAdsAccounts(): Promise<{
  error?: string;
  accounts?: GoogleAdsAccountPreview[];
}> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to save real connections." };
  }
  if (!env.GOOGLE_ADS_REFRESH_TOKEN) {
    return { error: "GOOGLE_ADS_REFRESH_TOKEN isn't set in this environment yet." };
  }
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    return { error: "GOOGLE_ADS_DEVELOPER_TOKEN isn't set in this environment yet." };
  }
  if (!env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    return { error: "GOOGLE_ADS_LOGIN_CUSTOMER_ID isn't set in this environment yet." };
  }

  try {
    const principal = await getPrincipal();
    authorize(principal, "connections.manage");
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    return { error: "Could not verify permissions right now." };
  }

  try {
    const { accessToken } = await refreshAccessToken(env.GOOGLE_ADS_REFRESH_TOKEN);
    const accounts = await listLinkedClientAccounts(
      accessToken,
      env.GOOGLE_ADS_DEVELOPER_TOKEN,
      env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    );
    if (accounts.length === 0) {
      return {
        error:
          "No client accounts found one level under this MCC — check GOOGLE_ADS_LOGIN_CUSTOMER_ID is the manager account's id (digits only, no dashes).",
      };
    }
    return {
      accounts: accounts.map((a) => ({
        customerId: a.customerId,
        name: a.descriptiveName,
        currency: a.currencyCode,
        timezone: a.timeZone,
      })),
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not reach Google Ads right now.",
    };
  }
}

export async function connectAgencyGoogleAdsAccounts(
  selections: GoogleAdsAccountSelection[],
): Promise<ActionResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to save real connections." };
  }
  if (!env.GOOGLE_ADS_REFRESH_TOKEN) {
    return { error: "GOOGLE_ADS_REFRESH_TOKEN isn't set in this environment yet." };
  }
  if (selections.length === 0) {
    return { error: "Pick at least one account." };
  }
  if (selections.some((s) => !s.workspaceId)) {
    return { error: "Pick a client workspace for every selected account." };
  }

  try {
    const principal = await getPrincipal();
    const db = getDb();

    for (const sel of selections) {
      authorize(principal, "connections.manage", sel.workspaceId);

      // Google Ads reporting is on-demand (see google-ads-live.ts) — no
      // integrationSecrets row saved here, same trick
      // connectAgencyMetaAccounts uses: an empty secret makes
      // google-ads-live.ts's resolveCreds() fall back to the shared
      // GOOGLE_ADS_REFRESH_TOKEN at read time.
      await db
        .insert(integrationConnections)
        .values({
          orgId: principal.orgId,
          workspaceId: sel.workspaceId,
          provider: "google_ads",
          externalAccountId: sel.customerId,
          displayName: sel.name,
          status: "active",
          grantedScopes: ["adwords"],
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

/**
 * TikTok manual-token connect — mirrors the Meta paste-a-token flow
 * exactly (previewMetaAccessToken/connectMetaAccounts). Given genuine
 * uncertainty about TikTok Business API token lifetimes (see tiktok.ts's
 * file-level comment), this paste flow — not OAuth — is the recommended
 * default: it works the same way regardless of how long the pasted token
 * lasts, and re-pasting a fresh one if it ever expires is a one-step fix.
 * Two steps: previewTikTokAccessToken lists every ad account the token can
 * reach, connectTikTokAccounts saves the ones picked.
 */

export interface TikTokAccountPreview {
  advertiserId: string;
  name: string;
  currency: string;
  timezone: string;
}

export interface TikTokAccountSelection extends TikTokAccountPreview {
  workspaceId: string;
}

export async function previewTikTokAccessToken(rawToken: string): Promise<{
  error?: string;
  accounts?: TikTokAccountPreview[];
}> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to save real connections." };
  }
  const accessToken = rawToken.trim();
  if (accessToken.length < 10) {
    return { error: "That doesn't look like a valid access token." };
  }
  if (!env.TIKTOK_APP_ID || !env.TIKTOK_APP_SECRET) {
    return { error: "TIKTOK_APP_ID/TIKTOK_APP_SECRET aren't set in this environment yet." };
  }

  try {
    const principal = await getPrincipal();
    authorize(principal, "connections.manage");
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    return { error: "Could not verify permissions right now." };
  }

  try {
    const advertiserIds = await fetchAuthorizedAdvertiserIds(accessToken, env.TIKTOK_APP_ID, env.TIKTOK_APP_SECRET);
    if (advertiserIds.length === 0) {
      return { error: "This token has no ad accounts attached to it." };
    }
    const infos = await fetchAdvertiserInfo(accessToken, advertiserIds);
    return {
      accounts: infos.map((a) => ({
        advertiserId: a.advertiserId,
        name: a.name,
        currency: a.currency,
        timezone: a.timezone,
      })),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reach TikTok right now." };
  }
}

export async function connectTikTokAccounts(
  rawToken: string,
  selections: TikTokAccountSelection[],
): Promise<ActionResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to save real connections." };
  }
  const accessToken = rawToken.trim();
  if (accessToken.length < 10) {
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
          provider: "tiktok",
          externalAccountId: sel.advertiserId,
          displayName: sel.name,
          status: "active",
          grantedScopes: ["reporting"],
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

      // No refresh token from a pasted-token connect (there was no OAuth
      // exchange) — if this token ever stops working, tiktok-live.ts
      // surfaces a normal auth error and re-pasting a fresh one here fixes
      // it, same as Meta's and Shopify's manual-token paths.
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
