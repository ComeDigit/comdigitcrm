import { createHmac, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPrincipal } from "@/lib/auth/principal";
import { can } from "@/lib/auth/authorize";

/**
 * TikTok OAuth — step 1. Redirects to TikTok's advertiser authorization
 * page with a signed, single-use state (CSRF), mirroring the Meta/Google
 * Ads OAuth start routes. Env-gated on TIKTOK_APP_ID/TIKTOK_APP_SECRET.
 *
 * TikTok's own consent screen lets the authorizing user pick WHICH of
 * their ad accounts to grant — selecting just one there is what keeps the
 * callback's "exactly one account" auto-connect path simple. For
 * connecting several client accounts under one TikTok Business Center
 * login at once, the "paste a token" flow in Settings (see
 * previewTikTokAccessToken) is the better fit — it lists every account a
 * token can reach and lets an admin pick a workspace per account, same as
 * Meta's manual-token path.
 */
export async function GET(request: NextRequest) {
  const appId = process.env.TIKTOK_APP_ID;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      {
        error:
          "TikTok connector not configured. Set TIKTOK_APP_ID and TIKTOK_APP_SECRET (create an app in the TikTok for Business developer portal).",
      },
      { status: 501 },
    );
  }

  const principal = await getPrincipal();
  if (!principal || !can(principal, "connections.manage")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const workspaceId = request.nextUrl.searchParams.get("workspace");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace is required" }, { status: 400 });
  }

  const { origin } = new URL(request.url);
  const nonce = randomBytes(16).toString("hex");
  const payload = `${workspaceId}:${nonce}`;
  const sig = createHmac("sha256", appSecret).update(payload).digest("hex");
  const state = `${payload}:${sig}`;

  const redirectUri = `${origin}/api/integrations/tiktok/callback`;
  const dialog = new URL("https://business-api.tiktok.com/portal/auth");
  dialog.searchParams.set("app_id", appId);
  dialog.searchParams.set("state", state);
  dialog.searchParams.set("redirect_uri", redirectUri);

  const response = NextResponse.redirect(dialog);
  response.cookies.set("tiktok_oauth_nonce", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/integrations/tiktok",
  });
  return response;
}
