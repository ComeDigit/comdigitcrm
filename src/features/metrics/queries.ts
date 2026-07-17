import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import { isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import { adInsightsDaily, shopSalesDaily } from "@/db/schema";
import {
  demoAdInsights,
  demoCampaigns,
  demoShopSales,
  type DemoProvider,
} from "@/features/demo-data/generator";
import { sumAdFacts, type AdFacts, type ShopFacts } from "@/lib/metrics/definitions";

/**
 * Metrics data access. One facade with two backends:
 * - demo mode → deterministic generator (zero keys)
 * - live mode → fact tables (tenant-scoped; caller passes a verified
 *   workspaceId that already went through authorize())
 * Pages and AI tools call THIS module — they never know which backend ran.
 */

export interface DailyAdPoint extends AdFacts {
  date: string;
  provider: string;
}

export interface DailyShopPoint extends ShopFacts {
  date: string;
}

export interface DateRange {
  since: string; // YYYY-MM-DD inclusive
  until: string;
}

export async function getAdDaily(
  workspaceId: string,
  range: DateRange,
  providers: DemoProvider[] = ["meta", "google_ads", "tiktok"],
): Promise<DailyAdPoint[]> {
  if (isDemoMode) {
    return providers
      .flatMap((p) => demoAdInsights(workspaceId, p, 90))
      .filter((r) => r.date >= range.since && r.date <= range.until);
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(adInsightsDaily)
    .where(
      and(
        eq(adInsightsDaily.workspaceId, workspaceId),
        gte(adInsightsDaily.date, range.since),
        lte(adInsightsDaily.date, range.until),
      ),
    );
  return rows
    .filter((r) => providers.includes(r.provider as DemoProvider))
    .map((r) => ({
      date: r.date,
      provider: r.provider,
      spendMinor: r.spendMinor,
      revenueMinor: r.revenueMinor,
      impressions: r.impressions,
      clicks: r.clicks,
      purchases: r.purchases,
      reach: r.reach,
      videoViews3s: r.videoViews3s,
      videoPlays: r.videoPlays,
      inlineLinkClicks: r.inlineLinkClicks,
      outboundClicks: r.outboundClicks,
      uniqueClicks: r.uniqueClicks,
      landingPageViews: r.landingPageViews,
      pageEngagements: r.pageEngagements,
      videoThruplays: r.videoThruplays,
      videoP50: r.videoP50,
      videoP75: r.videoP75,
      videoP100: r.videoP100,
      viewContent: r.viewContent,
      addToCart: r.addToCart,
      initiateCheckout: r.initiateCheckout,
      addPaymentInfo: r.addPaymentInfo,
      leads: r.leads,
    }));
}

export async function getShopDaily(
  workspaceId: string,
  range: DateRange,
): Promise<DailyShopPoint[]> {
  if (isDemoMode) {
    return demoShopSales(workspaceId, 90).filter(
      (r) => r.date >= range.since && r.date <= range.until,
    );
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(shopSalesDaily)
    .where(
      and(
        eq(shopSalesDaily.workspaceId, workspaceId),
        gte(shopSalesDaily.date, range.since),
        lte(shopSalesDaily.date, range.until),
      ),
    );
  return rows.map((r) => ({
    date: r.date,
    grossSalesMinor: r.grossSalesMinor,
    netSalesMinor: r.netSalesMinor,
    refundsMinor: r.refundsMinor,
    orders: r.orders,
    sessions: r.sessions,
    newCustomers: r.newCustomers,
    returningCustomers: r.returningCustomers,
  }));
}

export interface CampaignWithFacts {
  id: string;
  name: string;
  status: string;
  qualityRanking: string | null;
  engagementRateRanking: string | null;
  conversionRateRanking: string | null;
  facts: AdFacts;
}

/**
 * Per-campaign facts for the selected date range, one row per campaign.
 * Live mode joins the campaigns table (identity + rankings) against
 * adInsightsDaily summed over the range — this is the query the campaign
 * table on every ad channel page should use; it previously always rendered
 * demoCampaigns() even in live mode, which showed fake campaigns under a
 * real (possibly all-zero) KPI summary. Demo mode keeps using the seeded
 * generator so dashboards aren't empty before any connector is set up.
 */
export async function getCampaignsWithFacts(
  workspaceId: string,
  provider: DemoProvider,
  range: DateRange,
): Promise<CampaignWithFacts[]> {
  if (isDemoMode) {
    return demoCampaigns(workspaceId, provider).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      qualityRanking: c.qualityRanking,
      engagementRateRanking: c.engagementRateRanking,
      conversionRateRanking: c.conversionRateRanking,
      facts: c.facts,
    }));
  }

  const db = getDb();
  const campaignRows = await db.query.campaigns.findMany({
    where: (c, { eq: eqOp, and: andOp }) =>
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, provider)),
  });
  if (campaignRows.length === 0) return [];

  const insightRows = await db
    .select()
    .from(adInsightsDaily)
    .where(
      and(
        eq(adInsightsDaily.workspaceId, workspaceId),
        eq(adInsightsDaily.provider, provider),
        gte(adInsightsDaily.date, range.since),
        lte(adInsightsDaily.date, range.until),
      ),
    );

  const byCampaign = new Map<string, AdFacts[]>();
  for (const r of insightRows) {
    const facts: AdFacts = {
      spendMinor: r.spendMinor,
      revenueMinor: r.revenueMinor,
      impressions: r.impressions,
      clicks: r.clicks,
      purchases: r.purchases,
      reach: r.reach,
      videoViews3s: r.videoViews3s,
      videoPlays: r.videoPlays,
      inlineLinkClicks: r.inlineLinkClicks,
      outboundClicks: r.outboundClicks,
      uniqueClicks: r.uniqueClicks,
      landingPageViews: r.landingPageViews,
      pageEngagements: r.pageEngagements,
      videoThruplays: r.videoThruplays,
      videoP50: r.videoP50,
      videoP75: r.videoP75,
      videoP100: r.videoP100,
      viewContent: r.viewContent,
      addToCart: r.addToCart,
      initiateCheckout: r.initiateCheckout,
      addPaymentInfo: r.addPaymentInfo,
      leads: r.leads,
    };
    const list = byCampaign.get(r.campaignId) ?? [];
    list.push(facts);
    byCampaign.set(r.campaignId, list);
  }

  return campaignRows.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    qualityRanking: c.qualityRanking,
    engagementRateRanking: c.engagementRateRanking,
    conversionRateRanking: c.conversionRateRanking,
    facts: sumAdFacts(byCampaign.get(c.id) ?? []),
  }));
}

export function lastNDays(n: number): DateRange {
  const until = new Date();
  const since = new Date();
  since.setDate(until.getDate() - (n - 1));
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

export function previousPeriod(range: DateRange): DateRange {
  const since = new Date(range.since);
  const until = new Date(range.until);
  const days = Math.round((+until - +since) / 86_400_000) + 1;
  const prevUntil = new Date(since);
  prevUntil.setDate(since.getDate() - 1);
  const prevSince = new Date(prevUntil);
  prevSince.setDate(prevUntil.getDate() - (days - 1));
  return {
    since: prevSince.toISOString().slice(0, 10),
    until: prevUntil.toISOString().slice(0, 10),
  };
}

/**
 * Named date-range presets shown as quick-pick buttons on every report page.
 * "custom" isn't selectable directly — it's whatever resolveDateRange()
 * falls back to when the caller supplied an explicit since/until instead.
 */
export const RANGE_PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_7",
  "this_month",
  "last_30",
  "last_90",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number] | "custom";

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Monday-start week, matching how most agencies report weekly numbers. */
function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1) - day;
  const out = new Date(d);
  out.setDate(d.getDate() + diff);
  return out;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Resolves the date range every report page renders. Explicit since/until
 * query params (a custom range picked in the UI) always win; otherwise
 * falls back to the named preset, defaulting to "last_30" — the same
 * default every page used before this existed, so old bookmarks/links
 * without any date params keep behaving exactly as they did.
 */
export function resolveDateRange(params: {
  preset?: string;
  since?: string;
  until?: string;
}): { range: DateRange; preset: RangePreset } {
  if (params.since && params.until) {
    return { range: { since: params.since, until: params.until }, preset: "custom" };
  }

  const today = new Date();
  const todayIso = isoDate(today);

  switch (params.preset) {
    case "today":
      return { range: { since: todayIso, until: todayIso }, preset: "today" };
    case "yesterday": {
      const y = new Date(today);
      y.setDate(today.getDate() - 1);
      const yIso = isoDate(y);
      return { range: { since: yIso, until: yIso }, preset: "yesterday" };
    }
    case "this_week":
      return { range: { since: isoDate(startOfWeek(today)), until: todayIso }, preset: "this_week" };
    case "this_month":
      return { range: { since: isoDate(startOfMonth(today)), until: todayIso }, preset: "this_month" };
    case "last_7":
      return { range: lastNDays(7), preset: "last_7" };
    case "last_90":
      return { range: lastNDays(90), preset: "last_90" };
    case "last_30":
    default:
      return { range: lastNDays(30), preset: "last_30" };
  }
}

const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_7: "Last 7 days",
  this_month: "This month",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  custom: "",
};

/** Human-readable label for the period subtitle on every report page. */
export function formatRangeLabel(range: DateRange, preset: RangePreset): string {
  if (preset !== "custom") return PRESET_LABELS[preset];
  return range.since === range.until ? range.since : `${range.since} → ${range.until}`;
}
