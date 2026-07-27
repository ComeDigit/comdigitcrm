import "server-only";
import { tiktokFetch, mapTikTokFacts, TIKTOK_METRICS } from "./tiktok";
import type { AdFacts } from "@/lib/metrics/definitions";

/**
 * Deeper TikTok reporting than the campaign-grain report in tiktok-live.ts
 * (AUDIT_REPORT.md — Medium: "TikTok: Average Watch Time, Top Videos, Top
 * Creatives, Audience — none implemented"). Same on-demand-pull shape as
 * everything else in this app — nothing here is stored, it hits TikTok's
 * Business API the moment the page is opened. Mirrors meta-breakdowns.ts's
 * structure (raw fetchers here, orchestration in
 * tiktok-breakdowns-live.ts).
 *
 * Field names (average_video_play, average_video_play_per_user, the
 * /ad/get/ metadata fields, and the age/gender/country_code audience
 * dimensions) were cross-checked across TikTok's own help center plus
 * multiple independent third-party API references, same rigor as
 * tiktok.ts's existing fields — but exactly like the rest of this
 * integration, NONE of it has been exercised against a real TikTok ad
 * account yet (no approved developer app — see tiktok.ts's file-level
 * comment). A field-name mismatch would surface as a silently-zero column
 * rather than a crash, worth double-checking against a real account the
 * moment one is connected.
 *
 * "Top Videos" and "Top Creatives" are deliberately ONE table
 * (fetchTikTokAdInsights below), not two — TikTok's Ad entity already IS
 * the creative/video unit (an ad wraps exactly one video), unlike Meta
 * where ad set / ad are genuinely distinct groupings worth separate
 * tables. Average watch time is surfaced per-ad here rather than as a
 * blended account-level KPI card: TikTok's API only exposes pre-computed
 * per-entity averages, not a raw total-seconds counter, so there's no
 * correct way to re-aggregate it across ads (averaging averages would
 * silently misweight small and large ads equally) — per-ad, sortable by
 * spend, is the honest presentation.
 */

interface TikTokReportPage<T> {
  list?: T[];
  page_info?: { page: number; page_size: number; total_number: number; total_page: number };
}

/** Same page/page_info shape as tiktok.ts's own listCampaigns/getDailyInsights
 *  (every TikTok list-style endpoint returns this), generalized here so
 *  every fetcher below can share one paging loop instead of five copies. */
async function fetchAllTikTokPages<T>(
  path: string,
  accessToken: string,
  query: Record<string, string>,
): Promise<T[]> {
  const out: T[] = [];
  let page = 1;
  for (;;) {
    const data = await tiktokFetch<TikTokReportPage<T>>(path, accessToken, {
      query: { ...query, page: String(page), page_size: "200" },
    });
    out.push(...(data.list ?? []));
    const info = data.page_info;
    if (!info || info.page >= info.total_page) break;
    page += 1;
  }
  return out;
}

interface TikTokAdMetaRow {
  ad_id: string;
  ad_name?: string;
  adgroup_id?: string;
  adgroup_name?: string;
  video_id?: string;
}

interface TikTokAdReportRow {
  dimensions: { ad_id: string };
  metrics: Record<string, string>;
}

export interface TikTokAdInsight {
  id: string;
  name: string;
  adgroupId: string;
  adgroupName: string;
  /** TikTok-assigned video asset ID backing this ad's creative, when
   *  /ad/get/ returns one — null for ad types with no single video
   *  (e.g. an image/carousel ad). */
  videoId: string | null;
  /** Seconds — "average watch time per video view" (replays included). */
  avgWatchTimeSeconds: number;
  /** Seconds — "average watch time per unique viewer" (replays included). */
  avgWatchTimePerUserSeconds: number;
  facts: AdFacts;
}

/**
 * Ad-level insights: /ad/get/ for metadata (name, ad group, video id) +
 * /report/integrated/get/ at data_level AUCTION_AD for performance
 * (including the two watch-time metrics), merged by ad_id. Driven off the
 * report rows (only ads with delivery in-range produce a row) rather than
 * the metadata rows — an ad with zero activity this period has nothing
 * useful to show in a performance table, same precedent as Meta/Google Ads
 * ad-level breakdowns never listing zero-delivery entities either.
 */
export async function fetchTikTokAdInsights(
  accessToken: string,
  accountId: string,
  range: { since: string; until: string },
  currency: string,
): Promise<TikTokAdInsight[]> {
  const [metaRows, reportRows] = await Promise.all([
    fetchAllTikTokPages<TikTokAdMetaRow>("/ad/get/", accessToken, { advertiser_id: accountId }),
    fetchAllTikTokPages<TikTokAdReportRow>("/report/integrated/get/", accessToken, {
      advertiser_id: accountId,
      report_type: "BASIC",
      data_level: "AUCTION_AD",
      dimensions: JSON.stringify(["ad_id"]),
      metrics: JSON.stringify([...TIKTOK_METRICS, "average_video_play", "average_video_play_per_user"]),
      start_date: range.since,
      end_date: range.until,
    }),
  ]);

  const metaById = new Map(metaRows.map((r) => [r.ad_id, r]));
  return reportRows
    .map((row) => {
      const meta = metaById.get(row.dimensions.ad_id);
      const m = row.metrics;
      const num = (key: string) => parseFloat(m[key] ?? "0") || 0;
      return {
        id: row.dimensions.ad_id,
        name: meta?.ad_name ?? row.dimensions.ad_id,
        adgroupId: meta?.adgroup_id ?? "",
        adgroupName: meta?.adgroup_name ?? meta?.adgroup_id ?? "—",
        videoId: meta?.video_id ?? null,
        avgWatchTimeSeconds: num("average_video_play"),
        avgWatchTimePerUserSeconds: num("average_video_play_per_user"),
        facts: mapTikTokFacts(m, currency),
      };
    })
    .sort((a, b) => b.facts.spendMinor - a.facts.spendMinor);
}

interface TikTokAudienceRow {
  dimensions: Record<string, string>;
  metrics: Record<string, string>;
}

export interface TikTokAgeGenderInsight {
  age: string;
  gender: string;
  facts: AdFacts;
}

/**
 * Account-wide age/gender breakdown — report_type AUDIENCE, data_level
 * AUCTION_ADVERTISER (the account rollup, TikTok's analog of Meta's
 * level=account) with dimensions=[age,gender] and no date dimension, so
 * TikTok aggregates every row into one per age/gender bucket across the
 * whole range, same principle as fetchMetaAgeGenderBreakdown.
 */
export async function fetchTikTokAgeGenderBreakdown(
  accessToken: string,
  accountId: string,
  range: { since: string; until: string },
  currency: string,
): Promise<TikTokAgeGenderInsight[]> {
  const rows = await fetchAllTikTokPages<TikTokAudienceRow>("/report/integrated/get/", accessToken, {
    advertiser_id: accountId,
    report_type: "AUDIENCE",
    data_level: "AUCTION_ADVERTISER",
    dimensions: JSON.stringify(["age", "gender"]),
    metrics: JSON.stringify(TIKTOK_METRICS),
    start_date: range.since,
    end_date: range.until,
  });
  return rows
    .map((r) => ({
      age: r.dimensions.age,
      gender: r.dimensions.gender,
      facts: mapTikTokFacts(r.metrics, currency),
    }))
    .sort((a, b) => b.facts.spendMinor - a.facts.spendMinor);
}

export interface TikTokCountryInsight {
  country: string;
  facts: AdFacts;
}

/** Same shape as fetchTikTokAgeGenderBreakdown, dimensions=[country_code]
 *  — capped to the top 25 by spend, same precedent as Meta/Google Ads'
 *  country breakdowns (broad geo-targeting can return 100+ countries with
 *  negligible spend each). */
export async function fetchTikTokCountryBreakdown(
  accessToken: string,
  accountId: string,
  range: { since: string; until: string },
  currency: string,
): Promise<TikTokCountryInsight[]> {
  const rows = await fetchAllTikTokPages<TikTokAudienceRow>("/report/integrated/get/", accessToken, {
    advertiser_id: accountId,
    report_type: "AUDIENCE",
    data_level: "AUCTION_ADVERTISER",
    dimensions: JSON.stringify(["country_code"]),
    metrics: JSON.stringify(TIKTOK_METRICS),
    start_date: range.since,
    end_date: range.until,
  });
  return rows
    .map((r) => ({ country: r.dimensions.country_code, facts: mapTikTokFacts(r.metrics, currency) }))
    .sort((a, b) => b.facts.spendMinor - a.facts.spendMinor)
    .slice(0, 25);
}
