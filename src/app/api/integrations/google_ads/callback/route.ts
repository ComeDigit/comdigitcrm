import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPrincipal } from "@/lib/auth/principal";
import { authorize } from "@/lib/auth/authorize";
import { encryptSecret } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { integrationConnections, integrationSecrets } from "@/db/schema";
import { listAccessibleCustomers } from "@/features/integrations/google-ads";

/**
 * Google Ads OAuth — step 2. Verifies signed state + nonce cookie,
 * exchanges the code for tokens (server-to-server), and records the
 * connection. Google Ads reporting is on-demand (see
 * features/integrations/google-ads-live.ts) — nothing is enqueued here.
 *
 * Account selection: listAccessibleCustomers only ever returns accounts
 * this login was granted DIRECT access to (confirmed against Google's
 * docs — it does not walk an MCC's client hierarchy). For the common
 * "client authorizes their own account" case that's exactly one account,
 * so this auto-connects it. If it's ambiguous (zero or multiple), this
 * deliberately does NOT guess — picking the wrong one would attribute one
 * client's ad data to a different client's workspace, which is worse than
 * asking the admin to use the agency-wide flow instead (Settings → "Use
 * agency token"), which lets them pick explicitly from a full client list.
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Google Ads connector not configured" }, { status: 501 });
  }

  const principal = await getPrincipal();
  if (!principal) return NextResponse.redirect(new URL("/login", request.url));

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state") ?? "";
  const nonceCookie = request.cookies.get("google_ads_oauth_nonce")?.value;

  const [workspaceId, nonce, sig] = state.split(":");
  if (!code || !workspaceId || !nonce || !sig || nonce !== nonceCookie) {
    return NextResponse.redirect(`${origin}/dashboard/settings?google_ads=invalid_state`);
  }
  const expected = createHmac("sha256", clientSecret).update(`${workspaceId}:${nonce}`).digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.redirect(`${origin}/dashboard/settings?google_ads=invalid_state`);
  }

  try {
    authorize(principal, "connections.manage", workspaceId);
  } catch {
    return NextResponse.redirect(`${origin}/dashboard/settings?google_ads=forbidden`);
  }

  if (!developerToken) {
    return NextResponse.redirect(`${origin}/dashboard/settings?google_ads=no_developer_token`);
  }

  const redirectUri = `${origin}/api/integrations/google_ads/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return NextResponse.redirect(`${origin}/dashboard/settings?google_ads=token_error`);
  }
  const token = (await tokenRes.json()) as { access_token: string; refresh_token?: string };
  if (!token.refresh_token) {
    // Shouldn't happen with access_type=offline&prompt=consent, but if
    // Google ever omits it there's nothing durable to store — bail clearly
    // rather than saving a connection that stops working in an hour.
    return NextResponse.redirect(`${origin}/dashboard/settings?google_ads=no_refresh_token`);
  }

  let accounts;
  try {
    accounts = (await listAccessibleCustomers(token.access_token, developerToken)).filter((a) => !a.isManager);
  } catch {
    return NextResponse.redirect(`${origin}/dashboard/settings?google_ads=account_list_error`);
  }

  if (accounts.length === 0) {
    return NextResponse.redirect(`${origin}/dashboard/settings?google_ads=no_accounts`);
  }
  if (accounts.length > 1) {
    return NextResponse.redirect(`${origin}/dashboard/settings?google_ads=multiple_accounts`);
  }
  const account = accounts[0];

  const db = getDb();
  const [connection] = await db
    .insert(integrationConnections)
    .values({
      orgId: principal.orgId,
      workspaceId,
      provider: "google_ads",
      externalAccountId: account.customerId,
      displayName: account.descriptiveName,
      status: "active",
      grantedScopes: ["adwords"],
      currencyCode: account.currencyCode,
      timezone: account.timeZone,
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
      encryptedPayload: encryptSecret(JSON.stringify({ refreshToken: token.refresh_token })),
    })
    .onConflictDoUpdate({
      target: integrationSecrets.connectionId,
      set: {
        encryptedPayload: encryptSecret(JSON.stringify({ refreshToken: token.refresh_token })),
        rotatedAt: new Date(),
      },
    });

  const response = NextResponse.redirect(`${origin}/dashboard/settings?google_ads=connected`);
  response.cookies.delete("google_ads_oauth_nonce");
  return response;
}
