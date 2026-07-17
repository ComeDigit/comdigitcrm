import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPrincipal } from "@/lib/auth/principal";
import { authorize } from "@/lib/auth/authorize";
import { encryptSecret } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { integrationConnections, integrationSecrets } from "@/db/schema";

/**
 * Meta OAuth — step 2. Verifies signed state + nonce cookie, exchanges
 * the code for a long-lived token (server-to-server; the token never
 * touches the browser), encrypts it at rest, and records the connection.
 * Meta reporting is on-demand (see features/integrations/meta-live.ts) —
 * nothing is enqueued here; the first report is pulled live the moment
 * someone opens the Meta Ads page or a share link for this workspace.
 */
export async function GET(request: NextRequest) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json({ error: "Meta connector not configured" }, { status: 501 });
  }

  const principal = await getPrincipal();
  if (!principal) return NextResponse.redirect(new URL("/login", request.url));

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state") ?? "";
  const nonceCookie = request.cookies.get("meta_oauth_nonce")?.value;

  // Validate state: workspaceId:nonce:sig, HMAC-signed, nonce must match cookie.
  const [workspaceId, nonce, sig] = state.split(":");
  if (!code || !workspaceId || !nonce || !sig || nonce !== nonceCookie) {
    return NextResponse.redirect(`${origin}/dashboard/settings?meta=invalid_state`);
  }
  const expected = createHmac("sha256", appSecret)
    .update(`${workspaceId}:${nonce}`)
    .digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.redirect(`${origin}/dashboard/settings?meta=invalid_state`);
  }

  try {
    authorize(principal, "connections.manage", workspaceId);
  } catch {
    return NextResponse.redirect(`${origin}/dashboard/settings?meta=forbidden`);
  }

  // Exchange code → short-lived token → long-lived token (both server-side).
  const redirectUri = `${origin}/api/integrations/meta/callback`;
  const tokenUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  const shortRes = await fetch(tokenUrl);
  if (!shortRes.ok) {
    return NextResponse.redirect(`${origin}/dashboard/settings?meta=token_error`);
  }
  const shortToken = (await shortRes.json()) as { access_token: string };

  const longUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", shortToken.access_token);

  const longRes = await fetch(longUrl);
  if (!longRes.ok) {
    return NextResponse.redirect(`${origin}/dashboard/settings?meta=token_error`);
  }
  const longToken = (await longRes.json()) as {
    access_token: string;
    expires_in?: number;
  };

  // Discover the user's ad accounts (first one becomes the connection;
  // multi-account picker lands with the full Phase 7 UI).
  const accountsRes = await fetch(
    `https://graph.facebook.com/v21.0/me/adaccounts?fields=account_id,name,currency,timezone_name&access_token=${encodeURIComponent(longToken.access_token)}`,
  );
  const accounts = accountsRes.ok
    ? ((await accountsRes.json()) as {
        data?: Array<{
          account_id: string;
          name: string;
          currency: string;
          timezone_name: string;
        }>;
      })
    : { data: [] };
  const account = accounts.data?.[0];
  if (!account) {
    return NextResponse.redirect(`${origin}/dashboard/settings?meta=no_ad_accounts`);
  }

  const db = getDb();
  const [connection] = await db
    .insert(integrationConnections)
    .values({
      orgId: principal.orgId,
      workspaceId,
      provider: "meta",
      externalAccountId: account.account_id,
      displayName: account.name,
      status: "active",
      grantedScopes: ["ads_read", "business_management"],
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
      encryptedPayload: encryptSecret(
        JSON.stringify({
          accessToken: longToken.access_token,
          expiresAt: longToken.expires_in
            ? new Date(Date.now() + longToken.expires_in * 1000).toISOString()
            : undefined,
        }),
      ),
    })
    .onConflictDoUpdate({
      target: integrationSecrets.connectionId,
      set: {
        encryptedPayload: encryptSecret(
          JSON.stringify({ accessToken: longToken.access_token }),
        ),
        rotatedAt: new Date(),
      },
    });

  const response = NextResponse.redirect(`${origin}/dashboard/settings?meta=connected`);
  response.cookies.delete("meta_oauth_nonce");
  return response;
}
