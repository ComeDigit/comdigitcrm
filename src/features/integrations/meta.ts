import type {
  AdsProvider,
  CampaignRecord,
  DailyInsightRecord,
  PageResult,
  ProviderCredentials,
} from "./types";
import { ProviderAuthError, ProviderRateLimitError } from "./types";

/**
 * Live Meta Marketing API client (Graph v21). Campaign entities +
 * campaign-grain daily insights. Called only by sync workers with
 * decrypted credentials — never from client-facing code.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

interface MetaError {
  error?: { code?: number; message?: string };
}

async function graphGet<T>(path: string, token: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`);
  if (res.status === 401 || res.status === 403) throw new ProviderAuthError("Meta auth failed");
  if (res.status === 429) throw new ProviderRateLimitError(300);
  const body = (await res.json()) as T & MetaError;
  if (!res.ok) {
    const code = body.error?.code;
    if (code === 190) throw new ProviderAuthError("Meta token expired");
    if (code === 17 || code === 4) throw new ProviderRateLimitError(300);
    throw new Error(`Meta API error: ${body.error?.message ?? res.status}`);
  }
  return body;
}

/** Meta returns money as decimal strings in account currency. */
function toMinor(value: string | undefined): number {
  return Math.round(parseFloat(value ?? "0") * 100) || 0;
}

function mapStatus(s: string): CampaignRecord["status"] {
  if (s === "ACTIVE") return "active";
  if (s === "PAUSED") return "paused";
  if (s === "DELETED") return "deleted";
  return "archived";
}

/** Meta packs most conversion/engagement counts into an `actions` array keyed by action_type. */
type ActionList = Array<{ action_type: string; value: string }> | undefined;

function actionValue(list: ActionList, ...types: string[]): number {
  if (!list) return 0;
  for (const type of types) {
    const found = list.find((a) => a.action_type === type);
    if (found) return parseInt(found.value, 10) || 0;
  }
  return 0;
}

function actionMoney(list: ActionList, ...types: string[]): number {
  if (!list) return 0;
  for (const type of types) {
    const found = list.find((a) => a.action_type === type);
    if (found) return toMinor(found.value);
  }
  return 0;
}

interface MetaInsightRow {
  campaign_id: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  inline_link_clicks?: string;
  unique_clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  outbound_clicks?: Array<{ action_type: string; value: string }>;
  video_3_sec_watched_actions?: Array<{ action_type: string; value: string }>;
  video_thruplay_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p50_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p75_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p100_watched_actions?: Array<{ action_type: string; value: string }>;
}

const INSIGHT_FIELDS = [
  "campaign_id",
  "date_start",
  "spend",
  "impressions",
  "clicks",
  "reach",
  "inline_link_clicks",
  "unique_clicks",
  "actions",
  "action_values",
  "outbound_clicks",
  "video_3_sec_watched_actions",
  "video_thruplay_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p100_watched_actions",
].join(",");

function mapInsightRow(r: MetaInsightRow, currency: string): DailyInsightRecord {
  return {
    campaignExternalId: r.campaign_id,
    date: r.date_start,
    currencyCode: currency,
    spendMinor: toMinor(r.spend),
    revenueMinor: actionMoney(r.action_values, "omni_purchase", "purchase"),
    impressions: parseInt(r.impressions ?? "0", 10) || 0,
    clicks: parseInt(r.clicks ?? "0", 10) || 0,
    purchases: actionValue(r.actions, "omni_purchase", "purchase"),
    reach: parseInt(r.reach ?? "0", 10) || 0,
    videoViews3s: actionValue(r.video_3_sec_watched_actions, "video_view"),
    videoPlays: actionValue(r.video_3_sec_watched_actions, "video_view"),
    inlineLinkClicks: parseInt(r.inline_link_clicks ?? "0", 10) || 0,
    outboundClicks: actionValue(r.outbound_clicks, "outbound_click"),
    uniqueClicks: parseInt(r.unique_clicks ?? "0", 10) || 0,
    landingPageViews: actionValue(r.actions, "landing_page_view"),
    pageEngagements: actionValue(r.actions, "page_engagement", "post_engagement"),
    videoThruplays: actionValue(r.video_thruplay_watched_actions, "video_view"),
    videoP50: actionValue(r.video_p50_watched_actions, "video_view"),
    videoP75: actionValue(r.video_p75_watched_actions, "video_view"),
    videoP100: actionValue(r.video_p100_watched_actions, "video_view"),
    viewContent: actionValue(r.actions, "omni_view_content", "view_content"),
    addToCart: actionValue(r.actions, "omni_add_to_cart", "add_to_cart"),
    initiateCheckout: actionValue(r.actions, "omni_initiated_checkout", "initiate_checkout"),
    addPaymentInfo: actionValue(r.actions, "omni_add_payment_info", "add_payment_info"),
    leads: actionValue(r.actions, "onsite_conversion.lead_grouped", "lead"),
  };
}

export interface MetaTokenHealth {
  valid: boolean;
  expiresAt: number | null; // unix ms; null = never expires / unknown
  daysUntilExpiry: number | null;
  scopes: string[];
  error?: string;
}

/**
 * `/debug_token` health check — reports whether a token is valid, its
 * scopes, and how many days remain before expiry. Long-lived user tokens
 * last ~60 days; System User tokens usually never expire (expires_at comes
 * back as 0, surfaced here as `expiresAt: null`). Inspecting a token
 * normally requires an app access token (`APP_ID|APP_SECRET`); without one
 * this falls back to inspecting the token against itself, which works for
 * some token types but not all.
 */
export async function checkMetaTokenHealth(
  accessToken: string,
  appId?: string,
  appSecret?: string,
): Promise<MetaTokenHealth> {
  const inspectorToken = appId && appSecret ? `${appId}|${appSecret}` : accessToken;
  try {
    const res = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(inspectorToken)}`,
    );
    const body = (await res.json()) as {
      data?: { is_valid?: boolean; expires_at?: number; scopes?: string[] };
      error?: { message?: string };
    };
    if (!res.ok || !body.data) {
      return {
        valid: false,
        expiresAt: null,
        daysUntilExpiry: null,
        scopes: [],
        error: body.error?.message ?? "Meta rejected the token health check.",
      };
    }
    const expiresAtMs =
      body.data.expires_at && body.data.expires_at > 0 ? body.data.expires_at * 1000 : null;
    const daysUntilExpiry = expiresAtMs
      ? Math.floor((expiresAtMs - Date.now()) / 86_400_000)
      : null;
    return {
      valid: Boolean(body.data.is_valid),
      expiresAt: expiresAtMs,
      daysUntilExpiry,
      scopes: body.data.scopes ?? [],
    };
  } catch {
    return {
      valid: false,
      expiresAt: null,
      daysUntilExpiry: null,
      scopes: [],
      error: "Could not reach Meta right now.",
    };
  }
}

export function createMetaProvider(): AdsProvider {
  return {
    key: "meta",

    async listCampaigns(
      creds: ProviderCredentials,
      accountId: string,
      cursor?: string,
    ): Promise<PageResult<CampaignRecord>> {
      const after = cursor ? `&after=${encodeURIComponent(cursor)}` : "";
      const body = await graphGet<{
        data: Array<{
          id: string;
          name: string;
          status: string;
          objective?: string;
          daily_budget?: string;
        }>;
        paging?: { cursors?: { after?: string }; next?: string };
      }>(
        `/act_${accountId}/campaigns?fields=name,status,objective,daily_budget&limit=100${after}`,
        creds.accessToken,
      );
      return {
        items: body.data.map((c) => ({
          externalId: c.id,
          name: c.name,
          status: mapStatus(c.status),
          objective: c.objective,
          dailyBudgetMinor: c.daily_budget ? parseInt(c.daily_budget, 10) : undefined,
          currencyCode: creds.extra?.currency ?? "INR",
        })),
        nextCursor: body.paging?.next ? body.paging.cursors?.after : undefined,
      };
    },

    /**
     * Rankings are a separate, lighter query (campaign-grain quality/
     * engagement/conversion signals) — kept out of listCampaigns so a
     * ranking-fetch failure never blocks the entity sync itself.
     */
    async getRankings(
      creds: ProviderCredentials,
      accountId: string,
    ): Promise<Record<string, Pick<CampaignRecord, "qualityRanking" | "engagementRateRanking" | "conversionRateRanking">>> {
      try {
        const body = await graphGet<{
          data: Array<{
            campaign_id: string;
            quality_ranking?: string;
            engagement_rate_ranking?: string;
            conversion_rate_ranking?: string;
          }>;
        }>(
          `/act_${accountId}/insights?level=campaign&date_preset=last_7d&fields=campaign_id,quality_ranking,engagement_rate_ranking,conversion_rate_ranking&limit=200`,
          creds.accessToken,
        );
        const out: Record<string, { qualityRanking?: string; engagementRateRanking?: string; conversionRateRanking?: string }> = {};
        for (const r of body.data) {
          out[r.campaign_id] = {
            qualityRanking: r.quality_ranking,
            engagementRateRanking: r.engagement_rate_ranking,
            conversionRateRanking: r.conversion_rate_ranking,
          };
        }
        return out;
      } catch {
        return {}; // rankings are best-effort, never fatal to the sync
      }
    },

    async getDailyInsights(
      creds: ProviderCredentials,
      accountId: string,
      range: { since: string; until: string },
      cursor?: string,
    ): Promise<PageResult<DailyInsightRecord>> {
      const after = cursor ? `&after=${encodeURIComponent(cursor)}` : "";
      const timeRange = encodeURIComponent(
        JSON.stringify({ since: range.since, until: range.until }),
      );
      const body = await graphGet<{
        data: MetaInsightRow[];
        paging?: { cursors?: { after?: string }; next?: string };
      }>(
        `/act_${accountId}/insights?level=campaign&time_increment=1&time_range=${timeRange}&fields=${INSIGHT_FIELDS}&limit=200${after}`,
        creds.accessToken,
      );

      const currency = creds.extra?.currency ?? "INR";
      return {
        items: body.data.map((r) => mapInsightRow(r, currency)),
        nextCursor: body.paging?.next ? body.paging.cursors?.after : undefined,
      };
    },
  };
}
