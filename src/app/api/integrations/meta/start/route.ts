import { createHmac, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPrincipal } from "@/lib/auth/principal";
import { can } from "@/lib/auth/authorize";

/**
 * Meta OAuth — step 1. Redirects to Facebook's dialog with a signed,
 * single-use state (CSRF). Env-gated: returns a clear message until
 * META_APP_ID / META_APP_SECRET exist. Scopes: ads_read for insights.
 */
export async function GET(request: NextRequest) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      {
        error:
          "Meta connector not configured. Set META_APP_ID and META_APP_SECRET (create the app at developers.facebook.com).",
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

  const redirectUri = `${origin}/api/integrations/meta/callback`;
  const dialog = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  dialog.searchParams.set("client_id", appId);
  dialog.searchParams.set("redirect_uri", redirectUri);
  dialog.searchParams.set("state", state);
  dialog.searchParams.set("scope", "ads_read,business_management");

  const response = NextResponse.redirect(dialog);
  // Double-submit cookie: callback must present the same nonce.
  response.cookies.set("meta_oauth_nonce", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/integrations/meta",
  });
  return response;
}
