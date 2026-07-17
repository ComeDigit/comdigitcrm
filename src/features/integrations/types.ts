import type { AdFacts } from "@/lib/metrics/definitions";

/**
 * Provider-agnostic integration contract. Every provider (Meta, Google
 * Ads, TikTok, Shopify, GA4…) implements this interface; sync jobs and
 * the AI tool layer speak ONLY this contract, never provider SDKs
 * directly. The mock implementation satisfies the same interface, so the
 * whole product is developable and testable with zero API keys.
 */

export type ProviderKey =
  | "shopify"
  | "meta"
  | "google_ads"
  | "ga4"
  | "tiktok"
  | "search_console";

export interface ProviderCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  /** Provider-specific extras (shop domain, developer token…). */
  extra?: Record<string, string>;
}

export interface CampaignRecord {
  externalId: string;
  name: string;
  status: "active" | "paused" | "archived" | "deleted";
  objective?: string;
  dailyBudgetMinor?: number;
  currencyCode: string;
  /** Meta's categorical ad-quality signals, when the provider exposes them. */
  qualityRanking?: string;
  engagementRateRanking?: string;
  conversionRateRanking?: string;
}

export interface DailyInsightRecord extends AdFacts {
  campaignExternalId: string;
  date: string; // YYYY-MM-DD in account timezone
  currencyCode: string;
}

export interface PageResult<T> {
  items: T[];
  /** Opaque cursor: persist to sync_cursors; undefined = done. */
  nextCursor?: string;
}

export interface AdsProvider {
  readonly key: ProviderKey;
  listCampaigns(
    creds: ProviderCredentials,
    accountId: string,
    cursor?: string,
  ): Promise<PageResult<CampaignRecord>>;
  getDailyInsights(
    creds: ProviderCredentials,
    accountId: string,
    range: { since: string; until: string },
    cursor?: string,
  ): Promise<PageResult<DailyInsightRecord>>;
  /** Optional: campaign-grain quality/engagement/conversion rankings, best-effort. */
  getRankings?(
    creds: ProviderCredentials,
    accountId: string,
  ): Promise<
    Record<
      string,
      Pick<CampaignRecord, "qualityRanking" | "engagementRateRanking" | "conversionRateRanking">
    >
  >;
}

export class ProviderRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Rate limited; retry after ${retryAfterSeconds}s`);
  }
}

export class ProviderAuthError extends Error {
  /** Connection should be flagged reauth_required. */
  readonly requiresReauth = true;
}
