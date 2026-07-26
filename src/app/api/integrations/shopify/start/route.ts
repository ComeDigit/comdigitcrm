import { createHmac, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPrincipal } from "@/lib/auth/principal";
import { can } from "@/lib/auth/authorize";

/**
 * Shopify OAuth — step 1. Unlike Meta/Google Ads/TikTok, there's no single
 * global authorize URL to redirect to — Shopify's consent dialog lives on
 * the STORE's own domain (https://{shop}/admin/oauth/authorize), so this
 * route needs a `shop` query param up front alongside `workspace` (the
 * admin types the store domain before hitting Connect — same format the
 * paste-a-token flow already asks for). Env-gated: returns a clear message
 * until SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET exist (an app created in
 * the Shopify Partner/Dev Dashboard, "custom distribution" so it installs
 * on a client's store without App Store review — see Settings page copy).
 *
 * Scopes match connectShopifyStore's grantedScopes exactly, so a
 * connection made through this OAuth path and one made by pasting a token
 * are indistinguishable to the rest of the app.
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          "Shopify OAuth connector not configured. Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (create a custom-distribution app in the Shopify Partner/Dev Dashboard), or paste an Admin API access token instead.",
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

  let shop = (request.nextUrl.searchParams.get("shop") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (shop && !shop.includes(".")) shop = `${shop}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    return NextResponse.json(
      { error: "Enter a valid shop domain, e.g. yourstore.myshopify.com" },
      { status: 400 },
    );
  }

  const { origin } = new URL(request.url);
  const nonce = randomBytes(16).toString("hex");
  const payload = `${workspaceId}:${nonce}`;
  const sig = createHmac("sha256", clientSecret).update(payload).digest("hex");
  const state = `${payload}:${sig}`;

  const redirectUri = `${origin}/api/integrations/shopify/callback`;
  const dialog = new URL(`https://${shop}/admin/oauth/authorize`);
  dialog.searchParams.set("client_id", clientId);
  // Offline access (no grant_options[]=per-user) — a non-expiring token
  // tied to the store, not to whichever staff member approves the install.
  dialog.searchParams.set("scope", "read_orders,read_customers");
  dialog.searchParams.set("redirect_uri", redirectUri);
  dialog.searchParams.set("state", state);

  const response = NextResponse.redirect(dialog);
  response.cookies.set("shopify_oauth_nonce", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/integrations/shopify",
  });
  return response;
}
