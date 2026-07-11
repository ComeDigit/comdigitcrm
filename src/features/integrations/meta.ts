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
      const fields =
        "campaign_id,date_start,spend,impressions,clicks,reach,actions,action_values,video_3_sec_watched_actions";
      const body = await graphGet<{
        data: Array<{
          campaign_id: string;
          date_start: string;
          spend?: string;
          impressions?: string;
          clicks?: string;
          reach?: string;
          actions?: Array<{ action_type: string; value: string }>;
          action_values?: Array<{ action_type: string; value: string }>;
          video_3_sec_watched_actions?: Array<{ action_type: string; value: string }>;
        }>;
        paging?: { cursors?: { after?: string }; next?: string };
      }>(
        `/act_${accountId}/insights?level=campaign&time_increment=1&time_range=${timeRange}&fields=${fields}&limit=200${after}`,
        creds.accessToken,
      );

      const num = (
        list: Array<{ action_type: string; value: string }> | undefined,
        type: string,
      ) => parseInt(list?.find((a) => a.action_type === type)?.value ?? "0", 10) || 0;
      const money = (
        list: Array<{ action_type: string; value: string }> | undefined,
        type: string,
      ) => toMinor(list?.find((a) => a.action_type === type)?.value);

      return {
        items: body.data.map((r) => ({
          campaignExternalId: r.campaign_id,
          date: r.date_start,
          currencyCode: creds.extra?.currency ?? "INR",
          spendMinor: toMinor(r.spend),
          revenueMinor: money(r.action_values, "omni_purchase"),
          impressions: parseInt(r.impressions ?? "0", 10) || 0,
          clicks: parseInt(r.clicks ?? "0", 10) || 0,
          purchases: num(r.actions, "omni_purchase"),
          reach: parseInt(r.reach ?? "0", 10) || 0,
          videoViews3s: num(r.video_3_sec_watched_actions, "video_view"),
          videoPlays: 0,
        })),
        nextCursor: body.paging?.next ? body.paging.cursors?.after : undefined,
      };
    },
  };
}
