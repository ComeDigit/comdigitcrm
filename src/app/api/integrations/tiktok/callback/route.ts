import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPrincipal } from "@/lib/auth/principal";
import { authorize } from "@/lib/auth/authorize";
import { encryptSecret } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { integrationConnections, integrationSecrets } from "@/db/schema";
import { exchangeAuthCode, fetchAdvertiserInfo } from "@/features/integrations/tiktok";

/**
 * TikTok OAuth — step 2. Verifies signed state + nonce cookie, exchanges
 * the auth_code for an access (+ maybe refresh) token, and records the
 * connection. TikTok reporting is on-demand (see
 * features/integrations/tiktok-live.ts) — nothing is enqueued here.
 *
 * Auto-connects only when the token exchange returns exactly one
 * advertiser id — same "never guess which client an ambiguous account
 * list belongs to" rule as the Google Ads callback. If TikTok returns
 * more than one (the authorizing user granted several accounts on
 * TikTok's own consent screen instead of just this workspace's one), this
 * bails with clear guidance rather than risking one client seeing
 * another's numbers.
 */
export async function GET(request: NextRequest) {
  const appId = process.env.TIKTOK_APP_ID;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json({ error: "TikTok connector not configured" }, { status: 501 });
  }

  const principal = await getPrincipal();
  if (!principal) return NextResponse.redirect(new URL("/login", request.url));

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("auth_code") ?? searchParams.get("code");
  const state = searchParams.get("state") ?? "";
  const nonceCookie = request.cookies.get("tiktok_oauth_nonce")?.value;

  const [workspaceId, nonce, sig] = state.split(":");
  if (!code || !workspaceId || !nonce || !sig || nonce !== nonceCookie) {
    return NextResponse.redirect(`${origin}/dashboard/settings?tiktok=invalid_state`);
  }
  const expected = createHmac("sha256", appSecret).update(`${workspaceId}:${nonce}`).digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.redirect(`${origin}/dashboard/settings?tiktok=invalid_state`);
  }

  try {
    authorize(principal, "connections.manage", workspaceId);
  } catch {
    return NextResponse.redirect(`${origin}/dashboard/settings?tiktok=forbidden`);
  }

  let token;
  try {
    token = await exchangeAuthCode(appId, appSecret, code);
  } catch {
    return NextResponse.redirect(`${origin}/dashboard/settings?tiktok=token_error`);
  }

  if (token.advertiserIds.length === 0) {
    return NextResponse.redirect(`${origin}/dashboard/settings?tiktok=no_accounts`);
  }
  if (token.advertiserIds.length > 1) {
    return NextResponse.redirect(`${origin}/dashboard/settings?tiktok=multiple_accounts`);
  }

  let info;
  try {
    info = (await fetchAdvertiserInfo(token.accessToken, token.advertiserIds))[0];
  } catch {
    return NextResponse.redirect(`${origin}/dashboard/settings?tiktok=account_info_error`);
  }
  if (!info) {
    return NextResponse.redirect(`${origin}/dashboard/settings?tiktok=no_accounts`);
  }

  const db = getDb();
  const [connection] = await db
    .insert(integrationConnections)
    .values({
      orgId: principal.orgId,
      workspaceId,
      provider: "tiktok",
      externalAccountId: info.advertiserId,
      displayName: info.name,
      status: "active",
      grantedScopes: ["reporting"],
      currencyCode: info.currency,
      timezone: info.timezone,
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
      encryptedPayload: encryptSecret(
        JSON.stringify({ accessToken: token.accessToken, refreshToken: token.refreshToken }),
      ),
    })
    .onConflictDoUpdate({
      target: integrationSecrets.connectionId,
      set: {
        encryptedPayload: encryptSecret(
          JSON.stringify({ accessToken: token.accessToken, refreshToken: token.refreshToken }),
        ),
        rotatedAt: new Date(),
      },
    });

  const response = NextResponse.redirect(`${origin}/dashboard/settings?tiktok=connected`);
  response.cookies.delete("tiktok_oauth_nonce");
  return response;
}
