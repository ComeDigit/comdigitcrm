import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getPrincipal } from "@/lib/auth/principal";
import { authorize } from "@/lib/auth/authorize";
import { connectShopifyStore } from "@/features/integrations/actions";

/**
 * Shopify OAuth — step 2. Two independent signature checks before anything
 * else happens:
 *  1. OUR signed state (workspaceId:nonce:sig + nonce cookie) — standard
 *     CSRF protection, same pattern as the Meta/Google Ads/TikTok callbacks.
 *  2. SHOPIFY's own hmac param on the callback query string — proves this
 *     redirect genuinely came from Shopify and wasn't forged or modified
 *     in transit. Computed by sorting every param except hmac/signature
 *     alphabetically, joining as key=value&key=value, and HMAC-SHA256'ing
 *     with the app's client secret (per Shopify's documented
 *     authorization-code-grant spec).
 *
 * The token exchange asks for an offline token (no `expiring` flag), which
 * Shopify returns as non-expiring — matching what shopify-live.ts already
 * assumes (a static bearer token, no refresh logic). Persistence is
 * handed off to connectShopifyStore, the SAME function the paste-a-token
 * form calls, so both connect paths always produce an identical
 * connection and can never quietly drift apart.
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Shopify OAuth connector not configured" }, { status: 501 });
  }

  const principal = await getPrincipal();
  if (!principal) {
    return NextResponse.redirect(new URL("/dashboard/settings", request.url));
  }

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const shop = (searchParams.get("shop") ?? "").toLowerCase();
  const state = searchParams.get("state") ?? "";
  const hmac = searchParams.get("hmac");
  const nonceCookie = request.cookies.get("shopify_oauth_nonce")?.value;

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    return NextResponse.redirect(`${origin}/dashboard/settings?shopify=invalid_shop`);
  }

  // 1. Our own CSRF state: workspaceId:nonce:sig, nonce must match cookie.
  const [workspaceId, nonce, sig] = state.split(":");
  if (!code || !workspaceId || !nonce || !sig || nonce !== nonceCookie) {
    return NextResponse.redirect(`${origin}/dashboard/settings?shopify=invalid_state`);
  }
  const expectedSig = createHmac("sha256", clientSecret)
    .update(`${workspaceId}:${nonce}`)
    .digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expSigBuf = Buffer.from(expectedSig, "hex");
  if (sigBuf.length !== expSigBuf.length || !timingSafeEqual(sigBuf, expSigBuf)) {
    return NextResponse.redirect(`${origin}/dashboard/settings?shopify=invalid_state`);
  }

  // 2. Shopify's own hmac over the callback params — proves authenticity.
  if (!hmac) {
    return NextResponse.redirect(`${origin}/dashboard/settings?shopify=invalid_hmac`);
  }
  const message = [...searchParams.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const expectedHmac = createHmac("sha256", clientSecret).update(message).digest("hex");
  const hmacBuf = Buffer.from(hmac, "hex");
  const expHmacBuf = Buffer.from(expectedHmac, "hex");
  if (hmacBuf.length !== expHmacBuf.length || !timingSafeEqual(hmacBuf, expHmacBuf)) {
    return NextResponse.redirect(`${origin}/dashboard/settings?shopify=invalid_hmac`);
  }

  try {
    authorize(principal, "connections.manage", workspaceId);
  } catch {
    return NextResponse.redirect(`${origin}/dashboard/settings?shopify=forbidden`);
  }

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!tokenRes.ok) {
    return NextResponse.redirect(`${origin}/dashboard/settings?shopify=token_error`);
  }
  const tokenBody = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenBody.access_token) {
    return NextResponse.redirect(`${origin}/dashboard/settings?shopify=token_error`);
  }

  const result = await connectShopifyStore(workspaceId, shop, tokenBody.access_token);

  const response = NextResponse.redirect(
    result.error
      ? `${origin}/dashboard/settings?shopify=connect_error`
      : `${origin}/dashboard/settings?shopify=connected`,
  );
  response.cookies.delete("shopify_oauth_nonce");
  return response;
}
