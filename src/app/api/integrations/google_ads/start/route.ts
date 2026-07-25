import { createHmac, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPrincipal } from "@/lib/auth/principal";
import { can } from "@/lib/auth/authorize";

/**
 * Google Ads OAuth — step 1. Redirects to Google's consent dialog with a
 * signed, single-use state (CSRF), mirroring the Meta OAuth start route.
 * Env-gated: returns a clear message until GOOGLE_ADS_CLIENT_ID /
 * GOOGLE_ADS_CLIENT_SECRET exist. access_type=offline + prompt=consent are
 * both required — without them Google only issues a refresh token on a
 * user's very first consent ever, which makes reconnecting after a revoke
 * silently fail to produce one the second time.
 *
 * This path is for a client (or the admin) granting direct access to ONE
 * specific Google Ads account for ONE workspace — see the callback route
 * for why it refuses to guess when the authorizing login can see more than
 * one account. For an agency connecting several clients under its own MCC
 * from one login, the agency-wide flow (Settings → "Use agency token", see
 * actions.ts's previewAgencyGoogleAdsAccounts) is the better fit and
 * doesn't require running this OAuth dance per client at all.
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "Google Ads connector not configured. Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET (create an OAuth client in Google Cloud Console).",
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
  const sig = createHmac("sha256", clientSecret).update(payload).digest("hex");
  const state = `${payload}:${sig}`;

  const redirectUri = `${origin}/api/integrations/google_ads/callback`;
  const dialog = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  dialog.searchParams.set("client_id", clientId);
  dialog.searchParams.set("redirect_uri", redirectUri);
  dialog.searchParams.set("state", state);
  dialog.searchParams.set("response_type", "code");
  dialog.searchParams.set("scope", "https://www.googleapis.com/auth/adwords");
  dialog.searchParams.set("access_type", "offline");
  dialog.searchParams.set("prompt", "consent");

  const response = NextResponse.redirect(dialog);
  response.cookies.set("google_ads_oauth_nonce", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/integrations/google_ads",
  });
  return response;
}
