import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import { isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import { adInsightsDaily, shopSalesDaily } from "@/db/schema";
import {
  demoAdInsights,
  demoShopSales,
  type DemoProvider,
} from "@/features/demo-data/generator";
import type { AdFacts, ShopFacts } from "@/lib/metrics/definitions";

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
