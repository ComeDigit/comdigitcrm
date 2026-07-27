import { ProviderAuthError, ProviderRateLimitError } from "./types";
import type { ShopFacts } from "@/lib/metrics/definitions";

/**
 * Live Shopify Admin REST API client. Unlike Meta/Google Ads/TikTok,
 * Shopify has no campaigns/ad-spend — it reports STORE sales, so this
 * deliberately does NOT implement the `AdsProvider` interface (see
 * types.ts's note on why). Called only with a decrypted access token —
 * never from client-facing code.
 *
 * Connection model: a Shopify "custom app" (created per-store, directly in
 * that store's own admin — Settings → Apps and sales channels → Develop
 * apps), not a public OAuth app. This is the standard, Shopify-recommended
 * approach for an agency integrating a known, bounded list of client
 * stores: no App Store review, an Admin API access token is available the
 * moment the app is installed, and it never expires on its own (only if
 * revoked). Mirrors the same "paste a long-lived token" shape as Meta's
 * manual-connect path.
 */

const API_VERSION = "2024-10";

interface ShopifyErrorBody {
  errors?: string | Record<string, string[]>;
}

function shopUrl(shopDomain: string, path: string): string {
  return `https://${shopDomain}/admin/api/${API_VERSION}${path}`;
}

async function shopifyFetch<T>(shopDomain: string, path: string, accessToken: string): Promise<{ body: T; linkHeader: string | null }> {
  const res = await fetch(shopUrl(shopDomain, path), {
    headers: { "X-Shopify-Access-Token": accessToken, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    throw new ProviderAuthError("Shopify rejected the access token");
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "2");
    throw new ProviderRateLimitError(Math.max(1, Math.round(retryAfter)));
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ShopifyErrorBody;
    const message = typeof body.errors === "string" ? body.errors : JSON.stringify(body.errors ?? res.statusText);
    throw new Error(`Shopify API error: ${message}`);
  }
  const body = (await res.json()) as T;
  return { body, linkHeader: res.headers.get("link") };
}

/** Shopify's Link header: `<url>; rel="next", <url>; rel="previous"`. */
function nextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.split(",").find((part) => part.includes('rel="next"'));
  if (!match) return null;
  const urlMatch = match.match(/<([^>]+)>/);
  if (!urlMatch) return null;
  try {
    return new URL(urlMatch[1]).searchParams.get("page_info");
  } catch {
    return null;
  }
}

export interface ShopifyShopInfo {
  name: string;
  currency: string;
  timezone: string;
  domain: string;
}

/**
 * Verifies a {shop domain, access token} pair works, and returns basic shop
 * info to prefill the connection's display name/currency/timezone — the
 * same role `previewMetaAccessToken` plays before a connection is saved.
 */
export async function verifyShopifyCredentials(
  shopDomain: string,
  accessToken: string,
): Promise<ShopifyShopInfo> {
  const { body } = await shopifyFetch<{
    shop: { name: string; currency: string; iana_timezone: string; myshopify_domain: string };
  }>(shopDomain, "/shop.json", accessToken);
  return {
    name: body.shop.name,
    currency: body.shop.currency,
    timezone: body.shop.iana_timezone,
    domain: body.shop.myshopify_domain,
  };
}

interface ShopifyOrder {
  id: number;
  created_at: string;
  cancelled_at: string | null;
  total_price: string;
  customer?: { orders_count?: number } | null;
  refunds?: Array<{
    created_at: string;
    transactions?: Array<{ kind: string; status: string; amount: string }>;
  }>;
}

function toMinor(value: string | undefined): number {
  return Math.round(parseFloat(value ?? "0") * 100) || 0;
}

/**
 * Fetches every order in the date range (paginated fully via Shopify's
 * cursor-based `page_info` Link header) and aggregates into one ShopFacts
 * bucket per day. Cancelled orders are excluded from every total — they
 * were never a real sale. Refunds are attributed to the day the refund
 * itself happened, not the original order date, so a refund issued today
 * for an order placed last week shows up in today's numbers (matching how
 * Shopify's own Analytics reports refunds).
 *
 * Known limitation: Shopify's Admin REST API has no store-traffic/session
 * endpoint on any non-Plus plan (that needs the ShopifyQL Analytics API) —
 * `sessions` is always 0 here. Conversion rate on the Shopify report page
 * will read 0% as a result until a GA4/Search Console-style analytics
 * connector is added.
 */
export async function fetchShopifyDailyFacts(
  shopDomain: string,
  accessToken: string,
  range: { since: string; until: string },
): Promise<Map<string, ShopFacts>> {
  const byDate = new Map<string, ShopFacts>();
  const emptyFacts = (): ShopFacts => ({
    grossSalesMinor: 0,
    netSalesMinor: 0,
    refundsMinor: 0,
    orders: 0,
    sessions: 0,
    newCustomers: 0,
    returningCustomers: 0,
  });

  const createdMin = `${range.since}T00:00:00Z`;
  const createdMax = `${range.until}T23:59:59Z`;
  let pageInfo: string | null = null;
  let first = true;

  do {
    const query = first
      ? `status=any&created_at_min=${encodeURIComponent(createdMin)}&created_at_max=${encodeURIComponent(createdMax)}&limit=250&fields=id,created_at,cancelled_at,total_price,customer,refunds`
      : `limit=250&page_info=${encodeURIComponent(pageInfo!)}`;
    first = false;

    const { body, linkHeader } = await shopifyFetch<{ orders: ShopifyOrder[] }>(
      shopDomain,
      `/orders.json?${query}`,
      accessToken,
    );

    for (const order of body.orders) {
      if (order.cancelled_at) continue;
      const date = order.created_at.slice(0, 10);
      const entry = byDate.get(date) ?? emptyFacts();

      const total = toMinor(order.total_price);
      entry.grossSalesMinor += total;
      entry.netSalesMinor += total;
      entry.orders += 1;

      const lifetimeOrders = order.customer?.orders_count ?? 1;
      if (lifetimeOrders <= 1) entry.newCustomers += 1;
      else entry.returningCustomers += 1;

      byDate.set(date, entry);

      for (const refund of order.refunds ?? []) {
        const refundDate = refund.created_at.slice(0, 10);
        if (refundDate < range.since || refundDate > range.until) continue;
        const refundAmount = (refund.transactions ?? [])
          .filter((t) => t.kind === "refund" && t.status === "success")
          .reduce((sum, t) => sum + toMinor(t.amount), 0);
        if (refundAmount === 0) continue;
        const refundEntry = byDate.get(refundDate) ?? emptyFacts();
        refundEntry.refundsMinor += refundAmount;
        refundEntry.netSalesMinor -= refundAmount;
        byDate.set(refundDate, refundEntry);
      }
    }

    pageInfo = nextPageInfo(linkHeader);
  } while (pageInfo);

  return byDate;
}

interface ShopifyLineItem {
  product_id: number | null;
  title: string;
  sku: string | null;
  quantity: number;
  price: string;
  total_discount?: string;
}

interface ShopifyOrderWithLineItems {
  id: number;
  created_at: string;
  cancelled_at: string | null;
  line_items?: ShopifyLineItem[];
}

export interface ShopifyProductFacts {
  productId: number | null;
  title: string;
  sku: string | null;
  quantity: number;
  revenueMinor: number;
  orders: number;
}

/**
 * Per-product sales, aggregated from order line items (AUDIT_REPORT.md —
 * High: "Shopify product-level data missing"). Shopify's REST Admin API
 * has no dedicated "top products" report endpoint on non-Plus plans (the
 * richer breakdowns need the ShopifyQL Analytics API — same Plus-only wall
 * as the `sessions` limitation noted above) — so this derives product
 * performance the way most third-party Shopify apps do: paginate every
 * order in range and sum up its line_items. A separate pagination pass
 * from fetchShopifyDailyFacts (not merged into it) — costs one extra
 * Orders API call per page, but keeps that function's existing, working
 * contract untouched.
 *
 * revenueMinor is gross-of-refunds (line price × quantity, net of that
 * line's own discount) — refunds ARE captured correctly in the day-level
 * totals from fetchShopifyDailyFacts, but Shopify attributes refund money
 * to the refund record itself, and mapping that back down to individual
 * product lines needs a second field (refund_line_items) deliberately not
 * fetched here, to keep this a single query shape. A reasonable follow-up,
 * not a silent gap — "revenue" in the product table should be read as
 * "sales", not "net revenue after returns".
 */
export async function fetchShopifyProductFacts(
  shopDomain: string,
  accessToken: string,
  range: { since: string; until: string },
): Promise<ShopifyProductFacts[]> {
  const createdMin = `${range.since}T00:00:00Z`;
  const createdMax = `${range.until}T23:59:59Z`;
  let pageInfo: string | null = null;
  let first = true;

  interface Entry {
    productId: number | null;
    title: string;
    sku: string | null;
    quantity: number;
    revenueMinor: number;
    orderIds: Set<number>;
  }
  const byProduct = new Map<string, Entry>();

  do {
    const query = first
      ? `status=any&created_at_min=${encodeURIComponent(createdMin)}&created_at_max=${encodeURIComponent(createdMax)}&limit=250&fields=id,created_at,cancelled_at,line_items`
      : `limit=250&page_info=${encodeURIComponent(pageInfo!)}`;
    first = false;

    const { body, linkHeader } = await shopifyFetch<{ orders: ShopifyOrderWithLineItems[] }>(
      shopDomain,
      `/orders.json?${query}`,
      accessToken,
    );

    for (const order of body.orders) {
      if (order.cancelled_at) continue;
      for (const item of order.line_items ?? []) {
        const key = item.product_id != null ? `p:${item.product_id}` : `t:${item.title}`;
        const entry = byProduct.get(key) ?? {
          productId: item.product_id ?? null,
          title: item.title,
          sku: item.sku ?? null,
          quantity: 0,
          revenueMinor: 0,
          orderIds: new Set<number>(),
        };
        entry.quantity += item.quantity;
        entry.revenueMinor += toMinor(item.price) * item.quantity - toMinor(item.total_discount);
        entry.orderIds.add(order.id);
        byProduct.set(key, entry);
      }
    }

    pageInfo = nextPageInfo(linkHeader);
  } while (pageInfo);

  return [...byProduct.values()]
    .map((e) => ({
      productId: e.productId,
      title: e.title,
      sku: e.sku,
      quantity: e.quantity,
      revenueMinor: e.revenueMinor,
      orders: e.orderIds.size,
    }))
    .sort((a, b) => b.revenueMinor - a.revenueMinor);
}
