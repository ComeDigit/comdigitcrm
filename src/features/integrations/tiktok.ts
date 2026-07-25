import type {
  AdsProvider,
  CampaignRecord,
  DailyInsightRecord,
  PageResult,
  ProviderCredentials,
} from "./types";
import { ProviderAuthError, ProviderRateLimitError } from "./types";

/**
 * Live TikTok Marketing API client (Business API v1.3). Called only by
 * live-pull code (tiktok-live.ts) and the OAuth callback with decrypted
 * credentials — never from client-facing code.
 *
 * Built from TikTok's published v1.3 docs and consistent patterns across
 * third-party integration guides, NOT tested against a live account —
 * nobody has a TikTok for Business developer app approved yet (app review
 * is pending, same as Google Ads' developer token). Two things worth
 * flagging if a real account surfaces a mismatch:
 *
 * 1. Response envelope: every TikTok Business API response is HTTP 200
 *    with `{code, message, data, request_id}` — code 0 means success,
 *    anything else is an API-level error REGARDLESS of HTTP status. This
 *    client checks both the transport status and the envelope code, since
 *    sources disagree on which failures surface at which layer.
 * 2. Token lifetime: some TikTok docs describe a 24h access token + 1yr
 *    refresh token (mirroring the consumer Login Kit OAuth at
 *    open.tiktokapis.com); others describe the Business API's own token as
 *    longer-lived with no mandatory refresh. This client stores whatever
 *    the token exchange actually returns (access + refresh, if present)
 *    and only attempts a refresh reactively — when a call comes back with
 *    an auth error AND a refresh token is on file — rather than assuming
 *    either model up front.
 */

const API_BASE = "https://business-api.tiktok.com/open_api/v1.3";
const TOKEN_URL = `${API_BASE}/oauth2/access_token/`;

interface TikTokEnvelope<T> {
  code: number;
  message: string;
  data: T;
  request_id?: string;
}

/** code 0 = success. Everything else is an API-level error even though
 *  TikTok answers with HTTP 200 — never trust res.ok alone here. No
 *  specific numeric code is confirmed as "auth failure" from available
 *  docs (one confirmed example: message "The access token is invalid or
 *  not found in the request."), so this classifies by message text rather
 *  than citing exact codes that might be wrong. */
function isAuthError(_code: number, message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("access token") ||
    m.includes("access_token") ||
    (m.includes("auth") && (m.includes("invalid") || m.includes("expired") || m.includes("not found")))
  );
}

/** No specific rate-limit code is confirmed for this API from available
 *  docs, so this intentionally goes by message text only rather than a
 *  guessed numeric code that might be wrong. */
function isRateLimitError(_code: number, message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("rate limit") || m.includes("too many requests") || m.includes("qps");
}

async function tiktokFetch<T>(
  path: string,
  accessToken: string,
  init?: { method?: "GET" | "POST"; query?: Record<string, string>; body?: unknown },
): Promise<T> {
  let url = `${API_BASE}${path}`;
  if (init?.query) {
    const qs = new URLSearchParams(init.query).toString();
    url += `?${qs}`;
  }
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      "Access-Token": accessToken,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  if (res.status === 401 || res.status === 403) {
    throw new ProviderAuthError("TikTok rejected the access token");
  }
  if (res.status === 429) throw new ProviderRateLimitError(60);

  const envelope = (await res.json().catch(() => null)) as TikTokEnvelope<T> | null;
  if (!envelope || typeof envelope.code !== "number") {
    if (!res.ok) throw new Error(`TikTok API error: HTTP ${res.status}`);
    throw new Error("TikTok API returned an unexpected response shape");
  }
  if (envelope.code !== 0) {
    if (isAuthError(envelope.code, envelope.message)) {
      throw new ProviderAuthError(`TikTok rejected the request: ${envelope.message}`);
    }
    if (isRateLimitError(envelope.code, envelope.message)) {
      throw new ProviderRateLimitError(60);
    }
    throw new Error(`TikTok API error (${envelope.code}): ${envelope.message}`);
  }
  return envelope.data;
}

export interface TikTokTokenResult {
  accessToken: string;
  refreshToken?: string;
  advertiserIds: string[];
}

/**
 * Exchanges an authorization code (from the /portal/auth redirect) for an
 * access token. Uses app_id/secret/auth_code field names per TikTok's
 * Business API convention — deliberately NOT the generic OAuth2
 * client_id/client_secret/code naming Google/Meta use.
 */
export async function exchangeAuthCode(
  appId: string,
  appSecret: string,
  authCode: string,
): Promise<TikTokTokenResult> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, secret: appSecret, auth_code: authCode }),
  });
  const envelope = (await res.json().catch(() => null)) as TikTokEnvelope<{
    access_token?: string;
    refresh_token?: string;
    advertiser_ids?: string[];
  }> | null;
  if (!envelope || envelope.code !== 0 || !envelope.data.access_token) {
    throw new ProviderAuthError(
      envelope?.message ?? "TikTok rejected the authorization code — try connecting again.",
    );
  }
  return {
    accessToken: envelope.data.access_token,
    refreshToken: envelope.data.refresh_token,
    advertiserIds: envelope.data.advertiser_ids ?? [],
  };
}

/**
 * Best-effort refresh — attempted reactively (see the file-level doc
 * comment on token-lifetime uncertainty), never assumed to be required.
 * Mirrors exchangeAuthCode's request shape with grant_type added, the
 * closest documented pattern for this endpoint's refresh behavior.
 */
export async function refreshTikTokToken(
  appId: string,
  appSecret: string,
  refreshToken: string,
): Promise<TikTokTokenResult> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: appId,
      secret: appSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const envelope = (await res.json().catch(() => null)) as TikTokEnvelope<{
    access_token?: string;
    refresh_token?: string;
    advertiser_ids?: string[];
  }> | null;
  if (!envelope || envelope.code !== 0 || !envelope.data.access_token) {
    throw new ProviderAuthError(
      envelope?.message ?? "TikTok rejected the refresh token — reconnect in Settings.",
    );
  }
  return {
    accessToken: envelope.data.access_token,
    refreshToken: envelope.data.refresh_token ?? refreshToken,
    advertiserIds: envelope.data.advertiser_ids ?? [],
  };
}

/**
 * Lists advertiser accounts a PASTED access token can reach — lets an
 * admin connect TikTok the same low-friction way as Meta's "paste a
 * token" flow and Shopify's custom-app token, without running the OAuth
 * redirect dance at all. app_id/secret identify which app issued the
 * token; TikTok requires both alongside the token itself for this lookup.
 */
export async function fetchAuthorizedAdvertiserIds(
  accessToken: string,
  appId: string,
  appSecret: string,
): Promise<string[]> {
  // Docs for this specific endpoint show app_id/secret/Access_Token as
  // query params (unlike every other endpoint, which reads the token from
  // the Access-Token header) — sent both ways here since third-party
  // sources aren't fully consistent on which one this endpoint actually
  // reads, and sending both costs nothing.
  const data = await tiktokFetch<{ list?: Array<{ advertiser_id: string }> }>(
    "/oauth2/advertiser/get/",
    accessToken,
    { query: { app_id: appId, secret: appSecret, Access_Token: accessToken } },
  );
  return (data.list ?? []).map((a) => a.advertiser_id);
}

export interface AdvertiserInfo {
  advertiserId: string;
  name: string;
  currency: string;
  timezone: string;
}

/** Token exchange only returns advertiser IDs — this fills in the
 *  name/currency/timezone needed to create a connection. */
export async function fetchAdvertiserInfo(
  accessToken: string,
  advertiserIds: string[],
): Promise<AdvertiserInfo[]> {
  if (advertiserIds.length === 0) return [];
  const data = await tiktokFetch<{
    list?: Array<{ advertiser_id: string; name: string; currency: string; timezone: string }>;
  }>("/advertiser/info/", accessToken, {
    query: { advertiser_ids: JSON.stringify(advertiserIds) },
  });
  return (data.list ?? []).map((a) => ({
    advertiserId: a.advertiser_id,
    name: a.name,
    currency: a.currency,
    timezone: a.timezone,
  }));
}

function mapCampaignStatus(s: string | undefined): CampaignRecord["status"] {
  if (s === "ENABLE") return "active";
  if (s === "DISABLE") return "paused";
  if (s === "DELETE" || s === "REMOVE") return "deleted";
  return "archived";
}

interface TikTokCampaignRow {
  campaign_id: string;
  campaign_name: string;
  operation_status?: string;
  objective_type?: string;
  budget?: number;
  budget_mode?: string;
}

interface TikTokPageInfo {
  page: number;
  page_size: number;
  total_number: number;
  total_page: number;
}

export function createTikTokProvider(): AdsProvider {
  return {
    key: "tiktok",

    async listCampaigns(
      creds: ProviderCredentials,
      accountId: string,
      cursor?: string,
    ): Promise<PageResult<CampaignRecord>> {
      const page = cursor ? parseInt(cursor, 10) || 1 : 1;
      const data = await tiktokFetch<{ list?: TikTokCampaignRow[]; page_info?: TikTokPageInfo }>(
        "/campaign/get/",
        creds.accessToken,
        { query: { advertiser_id: accountId, page: String(page), page_size: "200" } },
      );
      const items: CampaignRecord[] = (data.list ?? []).map((c) => ({
        externalId: c.campaign_id,
        name: c.campaign_name,
        status: mapCampaignStatus(c.operation_status),
        objective: c.objective_type,
        // Many TikTok campaigns manage budget at the ad-group level, not
        // the campaign level — only BUDGET_MODE_DAY has a meaningful daily
        // figure here; BUDGET_MODE_TOTAL is a lifetime number (would be
        // misleading shown as "daily"), BUDGET_MODE_INFINITE has none.
        dailyBudgetMinor:
          c.budget_mode === "BUDGET_MODE_DAY" && typeof c.budget === "number"
            ? Math.round(c.budget * 100)
            : undefined,
        currencyCode: creds.extra?.currency ?? "USD",
      }));
      const info = data.page_info;
      const nextCursor = info && info.page < info.total_page ? String(info.page + 1) : undefined;
      return { items, nextCursor };
    },

    async getDailyInsights(
      creds: ProviderCredentials,
      accountId: string,
      range: { since: string; until: string },
      cursor?: string,
    ): Promise<PageResult<DailyInsightRecord>> {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(range.since) || !/^\d{4}-\d{2}-\d{2}$/.test(range.until)) {
        throw new Error(`Invalid date range for TikTok report: "${range.since}" .. "${range.until}"`);
      }
      const page = cursor ? parseInt(cursor, 10) || 1 : 1;
      const metrics = [
        "spend",
        "impressions",
        "clicks",
        "reach",
        "conversion",
        "video_play_actions",
        "video_watched_2s",
      ];
      const data = await tiktokFetch<{
        list?: Array<{
          dimensions: { campaign_id: string; stat_time_day: string };
          metrics: Record<string, string>;
        }>;
        page_info?: TikTokPageInfo;
      }>("/report/integrated/get/", creds.accessToken, {
        query: {
          advertiser_id: accountId,
          report_type: "BASIC",
          data_level: "AUCTION_CAMPAIGN",
          dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
          metrics: JSON.stringify(metrics),
          start_date: range.since,
          end_date: range.until,
          page: String(page),
          page_size: "200",
        },
      });

      const currency = creds.extra?.currency ?? "USD";
      const items: DailyInsightRecord[] = (data.list ?? []).map((row) => {
        const m = row.metrics;
        const num = (key: string) => parseFloat(m[key] ?? "0") || 0;
        const videoViews = num("video_play_actions");
        return {
          campaignExternalId: row.dimensions.campaign_id,
          date: row.dimensions.stat_time_day.slice(0, 10),
          currencyCode: currency,
          spendMinor: Math.round(num("spend") * 100),
          // TikTok's BASIC report has no direct "attributed revenue"
          // metric without a connected pixel/catalog reporting "value" —
          // left at 0 pending that setup, same documented-gap treatment as
          // Google Ads' funnel-breakdown fields below.
          revenueMinor: 0,
          impressions: Math.round(num("impressions")),
          clicks: Math.round(num("clicks")),
          purchases: Math.round(num("conversion")),
          reach: Math.round(num("reach")),
          videoViews3s: Math.round(num("video_watched_2s")), // closest available bucket to a 3s view
          videoPlays: Math.round(videoViews),
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
      });
      const info = data.page_info;
      const nextCursor = info && info.page < info.total_page ? String(info.page + 1) : undefined;
      return { items, nextCursor };
    },

    // No getRankings — TikTok has no per-campaign quality/engagement/
    // conversion ranking concept analogous to Meta's.
  };
}
