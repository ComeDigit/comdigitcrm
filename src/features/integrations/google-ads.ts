import type {
  AdsProvider,
  CampaignRecord,
  DailyInsightRecord,
  PageResult,
  ProviderCredentials,
} from "./types";
import { ProviderAuthError, ProviderRateLimitError } from "./types";
import { env } from "@/lib/env";

/**
 * Live Google Ads API client (REST interface, v17, queries written in
 * GAQL and sent to `googleAds:search`). Called only by live-pull code
 * (google-ads-live.ts) and the OAuth callback with decrypted/refreshed
 * credentials — never from client-facing code.
 *
 * Built against Google's documented v17 REST + GAQL contract. Unlike
 * Meta's Graph API (tested against this repo's actual dev account),
 * nobody has run this against a real Google Ads developer token yet —
 * there's no test account available while that approval is pending (see
 * the Settings page credential instructions). The request/response shapes
 * below match Google's published docs closely; if a real account surfaces
 * a field-naming or error-shape mismatch, checkGoogleAdsAccountsHealth's
 * `reasonFor()` in google-ads-live.ts is the first place to look — it logs
 * the raw error server-side on every failure.
 *
 * Access tokens expire after ~1 hour — every credential bundle here
 * carries a REFRESH token (from the one-time OAuth consent), and
 * refreshAccessToken() exchanges it for a short-lived access token before
 * each live pull (google-ads-live.ts caches the resulting access token for
 * ~50min so this doesn't hit Google's token endpoint every request).
 */

// v24 confirmed current as of July 2026 (v24 shipped April 2026, latest
// minor v24.2 in June 2026) — checked against Google's own release notes
// rather than assumed, since Ads API versions sunset roughly yearly.
const API_VERSION = "v24";
const API_BASE = `https://googleads.googleapis.com/${API_VERSION}`;
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GoogleTokenErrorBody {
  error?: string;
  error_description?: string;
}

export interface RefreshedToken {
  accessToken: string;
  expiresInSeconds: number;
}

/**
 * Exchanges a long-lived OAuth refresh token for a short-lived (~1hr)
 * access token. Requires GOOGLE_ADS_CLIENT_ID/SECRET — the same OAuth
 * client the consent flow used to mint the refresh token (Google ties
 * refresh tokens to the client that requested them; they can't be
 * redeemed against a different client id/secret).
 */
export async function refreshAccessToken(refreshToken: string): Promise<RefreshedToken> {
  const clientId = env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ProviderAuthError(
      "Google Ads connector not configured (missing GOOGLE_ADS_CLIENT_ID/GOOGLE_ADS_CLIENT_SECRET)",
    );
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (res.status === 400 || res.status === 401) {
    throw new ProviderAuthError(
      "Google rejected the refresh token — it's likely been revoked. Reconnect in Settings.",
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as GoogleTokenErrorBody;
    throw new Error(`Google token refresh failed: ${body.error_description ?? body.error ?? res.status}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: body.access_token, expiresInSeconds: body.expires_in };
}

/** developer-token and login-customer-id are agency-wide (env), not
 *  per-connection — carried on ProviderCredentials.extra so provider
 *  methods don't need extra parameters threaded through every call. */
export interface GoogleAdsCreds extends ProviderCredentials {
  extra?: Record<string, string>;
}

function authHeaders(creds: GoogleAdsCreds): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.accessToken}`,
    "Content-Type": "application/json",
  };
  if (creds.extra?.developerToken) headers["developer-token"] = creds.extra.developerToken;
  if (creds.extra?.loginCustomerId) headers["login-customer-id"] = creds.extra.loginCustomerId;
  return headers;
}

interface GoogleAdsErrorBody {
  error?: { code?: number; message?: string; status?: string };
}

/** Defense in depth: `range.since`/`range.until` ultimately trace back to a
 *  URL query param (the date-range picker) that isn't format-validated
 *  upstream. GAQL has no parameterized-query support over REST — the query
 *  is always a plain string — so anything embedded in a WHERE clause here
 *  MUST be checked first. Google-scoped blast radius is limited (the
 *  customer id in the URL path already bounds which account's data is
 *  reachable), but a malformed date could still corrupt the query. */
export function assertIsoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date range for Google Ads query: "${value}"`);
  }
  return value;
}

export async function gaqlSearch<T>(
  customerId: string,
  query: string,
  creds: GoogleAdsCreds,
  pageToken?: string,
): Promise<{ results: T[]; nextPageToken?: string }> {
  const res = await fetch(`${API_BASE}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: authHeaders(creds),
    body: JSON.stringify({ query, pageToken, pageSize: 10_000 }),
  });
  if (res.status === 401) throw new ProviderAuthError("Google Ads rejected the access token");
  if (res.status === 429) throw new ProviderRateLimitError(60);
  const body = (await res.json().catch(() => ({}))) as { results?: T[]; nextPageToken?: string } &
    GoogleAdsErrorBody;
  if (!res.ok) {
    if (res.status === 403) {
      throw new ProviderAuthError(body.error?.message ?? "Google Ads permission denied for this account");
    }
    if (res.status === 503) throw new ProviderRateLimitError(30);
    throw new Error(`Google Ads API error: ${body.error?.message ?? res.statusText}`);
  }
  return { results: body.results ?? [], nextPageToken: body.nextPageToken };
}

export interface AccessibleCustomer {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
  isManager: boolean;
}

/**
 * Discovers Google Ads customer ids the just-authenticated Google user has
 * been granted DIRECT access to. Confirmed against Google's own docs:
 * this does NOT walk an MCC's client hierarchy — a manager account's own
 * login only sees accounts it (or its user) was explicitly added to, not
 * every client linked beneath it. That makes this the right call for "a
 * client grants our app direct access to their own account" (the OAuth
 * button in Settings), and the WRONG call for "list every client under
 * our agency's MCC" — use listLinkedClientAccounts for that instead.
 */
export async function listAccessibleCustomers(
  accessToken: string,
  developerToken: string,
): Promise<AccessibleCustomer[]> {
  const res = await fetch(`${API_BASE}/customers:listAccessibleCustomers`, {
    headers: { Authorization: `Bearer ${accessToken}`, "developer-token": developerToken },
  });
  if (res.status === 401) throw new ProviderAuthError("Google Ads rejected the access token");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as GoogleAdsErrorBody;
    throw new Error(`Google Ads API error: ${body.error?.message ?? res.statusText}`);
  }
  const body = (await res.json()) as { resourceNames?: string[] };
  const ids = (body.resourceNames ?? []).map((rn) => rn.replace("customers/", ""));

  const creds: GoogleAdsCreds = { accessToken, extra: { developerToken } };
  const infos = await Promise.all(
    ids.map(async (id) => {
      try {
        return await fetchCustomerInfo(id, creds);
      } catch {
        return null; // an id we can list but can't read details for — skip it
      }
    }),
  );
  return infos.filter((c): c is AccessibleCustomer => c !== null);
}

interface GoogleAdsCustomerRow {
  customer: {
    id: string;
    descriptiveName?: string;
    currencyCode?: string;
    timeZone?: string;
    manager?: boolean;
  };
}

async function fetchCustomerInfo(customerId: string, creds: GoogleAdsCreds): Promise<AccessibleCustomer> {
  const query = "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1";
  const { results } = await gaqlSearch<GoogleAdsCustomerRow>(customerId, query, creds);
  const c = results[0]?.customer;
  return {
    customerId,
    descriptiveName: c?.descriptiveName ?? customerId,
    currencyCode: c?.currencyCode ?? "USD",
    timeZone: c?.timeZone ?? "UTC",
    isManager: c?.manager ?? false,
  };
}

export interface LinkedClientAccount {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
}

interface CustomerClientRow {
  customerClient: {
    id: string;
    descriptiveName?: string;
    currencyCode?: string;
    timeZone?: string;
    manager?: boolean;
    level?: string;
  };
}

/**
 * Lists client accounts linked one level directly under an agency's own
 * manager (MCC) account — the correct way for an agency to enumerate "which
 * of my clients can I report on" from its own login, without asking every
 * client to run their own OAuth consent (mirrors how Meta's agency-wide
 * token flow lists every ad account META_USER_TOKEN can see). Requires the
 * caller's access token to belong to a user with access to managerCustomerId
 * itself; login-customer-id is set to that manager for the query.
 *
 * Deliberately one level deep only — an agency nesting a sub-manager
 * between the top MCC and a client account won't see that client here.
 * Reasonable for a first pass; a recursive walk is a future enhancement if
 * an agency's hierarchy actually needs it.
 */
export async function listLinkedClientAccounts(
  accessToken: string,
  developerToken: string,
  managerCustomerId: string,
): Promise<LinkedClientAccount[]> {
  const creds: GoogleAdsCreds = {
    accessToken,
    extra: { developerToken, loginCustomerId: managerCustomerId },
  };
  const query =
    "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, " +
    "customer_client.time_zone, customer_client.manager, customer_client.level " +
    "FROM customer_client WHERE customer_client.level <= 1";
  const { results } = await gaqlSearch<CustomerClientRow>(managerCustomerId, query, creds);
  return results
    .filter((r) => r.customerClient.level !== "0" && !r.customerClient.manager)
    .map((r) => ({
      customerId: r.customerClient.id,
      descriptiveName: r.customerClient.descriptiveName ?? r.customerClient.id,
      currencyCode: r.customerClient.currencyCode ?? "USD",
      timeZone: r.customerClient.timeZone ?? "UTC",
    }));
}

/** 1,000,000 micros = 1 major currency unit = 100 minor units, so
 *  micros / 10,000 = minor units. */
export function microsToMinor(micros: string | undefined): number {
  return Math.round((parseInt(micros ?? "0", 10) || 0) / 10_000);
}

/** conversions_value is a decimal in major currency units (not micros). */
export function decimalToMinor(value: number | string | undefined): number {
  const n = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  return Math.round((n || 0) * 100);
}

function mapCampaignStatus(s: string): CampaignRecord["status"] {
  if (s === "ENABLED") return "active";
  if (s === "PAUSED") return "paused";
  if (s === "REMOVED") return "deleted";
  return "archived";
}

interface GoogleAdsCampaignRow {
  campaign: { id: string; name: string; status: string; advertisingChannelType?: string };
  campaignBudget?: { amountMicros?: string };
}

/** The metrics fields every insights-style GAQL query below selects —
 *  shared by the campaign-grain query here and google-ads-breakdowns.ts's
 *  keyword / search term / device / location queries, so they all map
 *  through the exact same mapGoogleAdsFacts logic instead of re-deriving
 *  it per breakdown. */
export interface GoogleAdsMetricsFields {
  costMicros?: string;
  impressions?: string;
  clicks?: string;
  conversions?: number | string;
  conversionsValue?: number | string;
  videoViews?: string;
}

interface GoogleAdsMetricsRow {
  campaign: { id: string };
  segments: { date: string };
  metrics: GoogleAdsMetricsFields;
}

/**
 * The AdFacts-shaped subset of a metrics row — factored out of
 * mapMetricsRow so google-ads-breakdowns.ts (keyword / search term /
 * device / location insights, which share this exact metrics shape but
 * aren't keyed by campaign+date the way DailyInsightRecord is) can reuse
 * the same parsing instead of re-deriving it. Only the metrics Google Ads
 * reports at this level are populated (spend, revenue, impressions,
 * clicks, conversions, video views); the funnel-stage breakdown fields
 * Meta gets for free from its `actions` array (addToCart,
 * initiateCheckout, leads, etc.) require a second query segmented by
 * conversion-action category — a reasonable follow-up, not implemented
 * here. `reach` is also 0: unique-reach isn't exposed by a simple GAQL
 * metric the way Meta's `reach` field is.
 */
export function mapGoogleAdsFacts(
  m: GoogleAdsMetricsFields,
  currency: string,
): Omit<DailyInsightRecord, "campaignExternalId" | "date"> {
  const videoViews = parseInt(m.videoViews ?? "0", 10) || 0;
  return {
    currencyCode: currency,
    spendMinor: microsToMinor(m.costMicros),
    revenueMinor: decimalToMinor(m.conversionsValue),
    impressions: parseInt(m.impressions ?? "0", 10) || 0,
    clicks: parseInt(m.clicks ?? "0", 10) || 0,
    purchases: Math.round(Number(m.conversions ?? 0)) || 0,
    reach: 0,
    // Google's `video_views` is the closest available analogue to Meta's
    // 3-second-view metric, not an exact equivalent — treat as approximate.
    videoViews3s: videoViews,
    videoPlays: videoViews,
    inlineLinkClicks: 0,
    outboundClicks: 0,
    uniqueClicks: 0,
    landingPageViews: 0,
    pageEngagements: 0,
    videoThruplays: 0,
    videoP50: 0,
    videoP75: 0,
    videoP100: 0,
    viewContent: 0,
    addToCart: 0,
    initiateCheckout: 0,
    addPaymentInfo: 0,
    leads: 0,
  };
}

function mapMetricsRow(r: GoogleAdsMetricsRow, currency: string): DailyInsightRecord {
  return {
    campaignExternalId: r.campaign.id,
    date: r.segments.date,
    ...mapGoogleAdsFacts(r.metrics, currency),
  };
}

export function createGoogleAdsProvider(): AdsProvider {
  return {
    key: "google_ads",

    async listCampaigns(
      creds: ProviderCredentials,
      accountId: string,
      cursor?: string,
    ): Promise<PageResult<CampaignRecord>> {
      const query =
        "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros " +
        "FROM campaign ORDER BY campaign.id";
      const { results, nextPageToken } = await gaqlSearch<GoogleAdsCampaignRow>(
        accountId,
        query,
        creds as GoogleAdsCreds,
        cursor,
      );
      return {
        items: results.map((r) => ({
          externalId: r.campaign.id,
          name: r.campaign.name,
          status: mapCampaignStatus(r.campaign.status),
          // Google Ads has no single "objective" field like Meta's — the ad
          // channel type (SEARCH, DISPLAY, PERFORMANCE_MAX, ...) is the
          // closest one-line description of what a campaign does.
          objective: r.campaign.advertisingChannelType,
          dailyBudgetMinor: r.campaignBudget?.amountMicros
            ? microsToMinor(r.campaignBudget.amountMicros)
            : undefined,
          currencyCode: creds.extra?.currency ?? "USD",
        })),
        nextCursor: nextPageToken,
      };
    },

    async getDailyInsights(
      creds: ProviderCredentials,
      accountId: string,
      range: { since: string; until: string },
      cursor?: string,
    ): Promise<PageResult<DailyInsightRecord>> {
      const since = assertIsoDate(range.since);
      const until = assertIsoDate(range.until);
      const query =
        "SELECT campaign.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, " +
        "metrics.conversions, metrics.conversions_value, metrics.video_views FROM campaign " +
        `WHERE segments.date BETWEEN '${since}' AND '${until}'`;
      const { results, nextPageToken } = await gaqlSearch<GoogleAdsMetricsRow>(
        accountId,
        query,
        creds as GoogleAdsCreds,
        cursor,
      );
      const currency = creds.extra?.currency ?? "USD";
      return {
        items: results.map((r) => mapMetricsRow(r, currency)),
        nextCursor: nextPageToken,
      };
    },

    // No getRankings: Google Ads' closest concept (Quality Score) lives at
    // the keyword level, not the campaign level, so it doesn't map onto
    // CampaignRecord's per-campaign ranking fields the way Meta's do.
  };
}
