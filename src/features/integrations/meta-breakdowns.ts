import "server-only";
import { graphGet, INSIGHT_FIELDS, mapInsightFacts, type MetaInsightRow } from "./meta";
import type { AdFacts } from "@/lib/metrics/definitions";

/**
 * Deeper Meta reporting than the campaign-grain report in meta-live.ts:
 * ad set / ad level insights (AUDIT_REPORT.md — High: "Meta Ad Sets + Ads
 * level breakdown missing") and age/gender/country audience breakdowns
 * (High: "Meta Audience Breakdown missing"). Same on-demand-pull shape as
 * everything else in this app — nothing here is stored, it hits Graph the
 * moment the page is opened.
 *
 * Deliberately reuses INSIGHT_FIELDS + mapInsightFacts from meta.ts rather
 * than a slimmer field set: it costs nothing extra (Graph charges the same
 * either way for one more field in an existing call) and means every table
 * below gets the exact same ROAS/CPA/CTR/etc. metrics as the campaigns
 * table, via the same adMetrics helpers — no separate "lite" AdFacts shape
 * to keep in sync.
 *
 * Ad set/ad rows deliberately do NOT include entity status (active/paused)
 * — Meta's insights endpoint doesn't return it, and fetching it would mean
 * a second list call (a whole extra paginated request) per level, on top
 * of an already-heavier page load once these are added to the campaign
 * report. Spend/performance is the primary thing worth checking at this
 * granularity; campaign-level status (already shown) is the on/off signal.
 */

interface GraphPage<T> {
  data: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

async function fetchAllPages<T>(path: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined;
  const current = path;
  do {
    const sep = current.includes("?") ? "&" : "?";
    const url = next ? `${current}${sep}after=${encodeURIComponent(next)}` : current;
    const body = await graphGet<GraphPage<T>>(url, token);
    out.push(...body.data);
    next = body.paging?.next ? body.paging.cursors?.after : undefined;
  } while (next);
  return out;
}

/** Every INSIGHT_FIELDS entry except campaign_id/date_start — those are
 *  either re-added explicitly (campaign_id) or irrelevant (date_start, since
 *  every fetch below aggregates over the whole range in one row per entity
 *  rather than a daily trend). */
const FACT_FIELDS = INSIGHT_FIELDS.split(",").filter((f) => f !== "campaign_id" && f !== "date_start");

export interface MetaAdSetInsight {
  id: string;
  name: string;
  campaignId: string;
  facts: AdFacts;
}

export async function fetchMetaAdSetInsights(
  accessToken: string,
  accountId: string,
  range: { since: string; until: string },
  currency: string,
): Promise<MetaAdSetInsight[]> {
  const timeRange = encodeURIComponent(JSON.stringify({ since: range.since, until: range.until }));
  const fields = ["adset_id", "adset_name", "campaign_id", ...FACT_FIELDS].join(",");
  const rows = await fetchAllPages<MetaInsightRow & { adset_id: string; adset_name: string }>(
    `/act_${accountId}/insights?level=adset&time_range=${timeRange}&fields=${fields}&limit=200`,
    accessToken,
  );
  return rows.map((r) => ({
    id: r.adset_id,
    name: r.adset_name,
    campaignId: r.campaign_id,
    facts: mapInsightFacts(r, currency),
  }));
}

export interface MetaAdInsight {
  id: string;
  name: string;
  adsetId: string;
  campaignId: string;
  facts: AdFacts;
}

export async function fetchMetaAdInsights(
  accessToken: string,
  accountId: string,
  range: { since: string; until: string },
  currency: string,
): Promise<MetaAdInsight[]> {
  const timeRange = encodeURIComponent(JSON.stringify({ since: range.since, until: range.until }));
  const fields = ["ad_id", "ad_name", "adset_id", "campaign_id", ...FACT_FIELDS].join(",");
  const rows = await fetchAllPages<MetaInsightRow & { ad_id: string; ad_name: string; adset_id: string }>(
    `/act_${accountId}/insights?level=ad&time_range=${timeRange}&fields=${fields}&limit=200`,
    accessToken,
  );
  return rows.map((r) => ({
    id: r.ad_id,
    name: r.ad_name,
    adsetId: r.adset_id,
    campaignId: r.campaign_id,
    facts: mapInsightFacts(r, currency),
  }));
}

export interface MetaAgeGenderInsight {
  age: string;
  gender: string;
  facts: AdFacts;
}

export async function fetchMetaAgeGenderBreakdown(
  accessToken: string,
  accountId: string,
  range: { since: string; until: string },
  currency: string,
): Promise<MetaAgeGenderInsight[]> {
  const timeRange = encodeURIComponent(JSON.stringify({ since: range.since, until: range.until }));
  const fields = ["age", "gender", ...FACT_FIELDS].join(",");
  const rows = await fetchAllPages<MetaInsightRow & { age: string; gender: string }>(
    `/act_${accountId}/insights?level=account&breakdowns=age,gender&time_range=${timeRange}&fields=${fields}&limit=200`,
    accessToken,
  );
  return rows
    .map((r) => ({ age: r.age, gender: r.gender, facts: mapInsightFacts(r, currency) }))
    .sort((a, b) => b.facts.spendMinor - a.facts.spendMinor);
}

export interface MetaCountryInsight {
  country: string;
  facts: AdFacts;
}

export async function fetchMetaCountryBreakdown(
  accessToken: string,
  accountId: string,
  range: { since: string; until: string },
  currency: string,
): Promise<MetaCountryInsight[]> {
  const timeRange = encodeURIComponent(JSON.stringify({ since: range.since, until: range.until }));
  const fields = ["country", ...FACT_FIELDS].join(",");
  const rows = await fetchAllPages<MetaInsightRow & { country: string }>(
    `/act_${accountId}/insights?level=account&breakdowns=country&time_range=${timeRange}&fields=${fields}&limit=200`,
    accessToken,
  );
  // Capped to the top 25 by spend — an account running broad geo-targeting
  // can return 100+ countries with negligible spend each; nobody needs a
  // 100-row table for that.
  return rows
    .map((r) => ({ country: r.country, facts: mapInsightFacts(r, currency) }))
    .sort((a, b) => b.facts.spendMinor - a.facts.spendMinor)
    .slice(0, 25);
}
