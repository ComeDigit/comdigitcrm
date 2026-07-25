import "server-only";
import { isDemoMode } from "@/lib/env";
import { getLiveMetaReport } from "./meta-live";
import { getLiveGoogleAdsReport } from "./google-ads-live";
import { getLiveTikTokReport } from "./tiktok-live";
import { sumAdFacts, type AdFacts } from "@/lib/metrics/definitions";
import type { DateRange, DailyAdPoint } from "@/features/metrics/queries";

/**
 * Blends live ad data across all three "pull-on-demand" providers (Meta,
 * Google Ads, TikTok) into one report — the shared piece OverviewReport
 * and AiInsights both need (a whole-account view, not one channel at a
 * time). features/ads/channel-page.tsx does NOT use this: it shows one
 * provider at a time and calls that provider's own getLiveXReport
 * directly, so it isn't paying for the other two providers' API calls on
 * every single-channel page view.
 *
 * Each underlying getLiveXReport already no-ops (one cheap DB query, no
 * external API call) when a workspace has zero connections for that
 * provider, so calling all three unconditionally here is safe and cheap
 * even for a client connected to just one channel.
 */

export type AdProviderKey = "meta" | "google_ads" | "tiktok";

export const AD_PROVIDER_KEYS = ["meta", "google_ads", "tiktok"] as const;

export const AD_PROVIDER_LABELS: Record<AdProviderKey, string> = {
  meta: "Meta",
  google_ads: "Google Ads",
  tiktok: "TikTok",
};

export interface AdFetchFailure {
  provider: AdProviderKey;
  displayName: string;
  reason: string;
}

export interface ProviderReport {
  totals: AdFacts;
  trend: Array<{ date: string; spendMinor: number; revenueMinor: number }>;
}

export interface LiveAdsReport {
  totals: AdFacts;
  trend: Array<{ date: string; spendMinor: number; revenueMinor: number }>;
  byProvider: Record<AdProviderKey, ProviderReport>;
  partialFailure: boolean;
  failures: AdFetchFailure[];
}

function mergeTrend(
  trends: Array<Array<{ date: string; spendMinor: number; revenueMinor: number }>>,
): Array<{ date: string; spendMinor: number; revenueMinor: number }> {
  const byDate = new Map<string, { date: string; spendMinor: number; revenueMinor: number }>();
  for (const trend of trends) {
    for (const row of trend) {
      const entry = byDate.get(row.date) ?? { date: row.date, spendMinor: 0, revenueMinor: 0 };
      entry.spendMinor += row.spendMinor;
      entry.revenueMinor += row.revenueMinor;
      byDate.set(row.date, entry);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function getLiveAdsReport(workspaceId: string, range: DateRange): Promise<LiveAdsReport> {
  const empty: ProviderReport = { totals: sumAdFacts([]), trend: [] };
  if (isDemoMode) {
    return {
      totals: empty.totals,
      trend: [],
      byProvider: { meta: empty, google_ads: empty, tiktok: empty },
      partialFailure: false,
      failures: [],
    };
  }

  const [meta, googleAds, tiktok] = await Promise.all([
    getLiveMetaReport(workspaceId, range),
    getLiveGoogleAdsReport(workspaceId, range),
    getLiveTikTokReport(workspaceId, range),
  ]);

  const failures: AdFetchFailure[] = [
    ...meta.failures.map((f) => ({ provider: "meta" as const, ...f })),
    ...googleAds.failures.map((f) => ({ provider: "google_ads" as const, ...f })),
    ...tiktok.failures.map((f) => ({ provider: "tiktok" as const, ...f })),
  ];

  const byProvider: Record<AdProviderKey, ProviderReport> = {
    meta: { totals: meta.totals, trend: meta.trend },
    google_ads: { totals: googleAds.totals, trend: googleAds.trend },
    tiktok: { totals: tiktok.totals, trend: tiktok.trend },
  };

  return {
    totals: sumAdFacts([meta.totals, googleAds.totals, tiktok.totals]),
    trend: mergeTrend([meta.trend, googleAds.trend, tiktok.trend]),
    byProvider,
    partialFailure: meta.partialFailure || googleAds.partialFailure || tiktok.partialFailure,
    failures,
  };
}

/**
 * Shapes demo-mode DB rows (flat, one row per provider+date) into the same
 * {totals, trend, byProvider} shape getLiveAdsReport returns above, so
 * callers (OverviewReport, AiInsights) read one shape regardless of
 * whether the data came from a live pull or the demo-mode generator.
 */
export function adsReportFromRows(rows: DailyAdPoint[]): LiveAdsReport {
  const byProvider = {} as LiveAdsReport["byProvider"];
  for (const key of AD_PROVIDER_KEYS) {
    const providerRows = rows.filter((r) => r.provider === key);
    byProvider[key] = {
      totals: sumAdFacts(providerRows),
      trend: providerRows.map((r) => ({ date: r.date, spendMinor: r.spendMinor, revenueMinor: r.revenueMinor })),
    };
  }
  const trendMap = new Map<string, { date: string; spendMinor: number; revenueMinor: number }>();
  for (const r of rows) {
    const entry = trendMap.get(r.date) ?? { date: r.date, spendMinor: 0, revenueMinor: 0 };
    entry.spendMinor += r.spendMinor;
    entry.revenueMinor += r.revenueMinor;
    trendMap.set(r.date, entry);
  }
  return {
    totals: sumAdFacts(rows),
    trend: [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byProvider,
    partialFailure: false,
    failures: [],
  };
}
