import "server-only";
import {
  getCampaignsWithFacts,
  type DateRange,
  type RangePreset,
  type CampaignWithFacts,
} from "@/features/metrics/queries";
import { getLiveMetaReport } from "@/features/integrations/meta-live";
import { getLiveGoogleAdsReport } from "@/features/integrations/google-ads-live";
import { getLiveTikTokReport } from "@/features/integrations/tiktok-live";
import { adMetrics } from "@/lib/metrics/definitions";
import { csvRow, csvDocument, slugifyForFilename } from "@/lib/csv";
import type { DemoProvider } from "@/features/demo-data/generator";
import { isDemoMode } from "@/lib/env";

/**
 * Campaign rows for CSV export — the same data AdsReport's Campaigns table
 * renders, but only the single current-range pull: no previous-period
 * comparison, no pacing, no ad set/keyword/audience breakdowns, none of
 * which a spend/revenue-per-campaign CSV needs. Kept as a plain data fetch
 * (no JSX, no auth) so the admin and client-portal export routes can share
 * it despite resolving workspaceId completely differently — see the two
 * route.ts files that call this for why they aren't one shared handler
 * (AdsReport itself spans three different auth surfaces; a single generic
 * route trusting a query-param workspaceId would risk cross-tenant leaks).
 */
export async function getCampaignsForExport(
  workspaceId: string,
  provider: DemoProvider,
  range: DateRange,
): Promise<CampaignWithFacts[]> {
  if (isDemoMode) return getCampaignsWithFacts(workspaceId, provider, range);
  if (provider === "meta") return (await getLiveMetaReport(workspaceId, range)).campaigns;
  if (provider === "google_ads") return (await getLiveGoogleAdsReport(workspaceId, range)).campaigns;
  return (await getLiveTikTokReport(workspaceId, range)).campaigns;
}

export function isExportableProvider(value: string | null): value is DemoProvider {
  return value === "meta" || value === "google_ads" || value === "tiktok";
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rejects anything that isn't a plain YYYY-MM-DD. Every OTHER caller of
 * resolveDateRange only ever sees since/until via <input type="date">
 * (browser-constrained to this exact shape) or a server-computed
 * lastNDays() — this is the first place they arrive as a raw query-string
 * value an attacker fully controls. Without this check, a crafted
 * since/until containing a CR/LF flows straight into
 * campaignExportFilename() and crashes NextResponse's header construction
 * (verified against this app's Next.js version: it throws "invalid header
 * value" on a raw \r\n inside Content-Disposition) — an unauthenticated
 * crash on the admin export route, since that surface has no login wall
 * by design. null (param not supplied) is valid — resolveDateRange falls
 * back to the preset/default range in that case.
 */
export function isValidDateParam(value: string | null): boolean {
  return value === null || ISO_DATE_RE.test(value);
}

/** Mirrors campaignTableHref's preset-vs-custom logic in channel-page.tsx
 *  (custom range → explicit since/until, named preset → just the key) —
 *  keep the two in sync if that logic ever changes. */
export function campaignExportHref(
  base: "/api/export/campaigns" | "/client/export/campaigns",
  provider: DemoProvider,
  preset: RangePreset,
  range: DateRange,
): string {
  const params = new URLSearchParams({ provider });
  if (preset !== "custom") params.set("preset", preset);
  else {
    params.set("since", range.since);
    params.set("until", range.until);
  }
  return `${base}?${params.toString()}`;
}

export function campaignExportFilename(workspaceName: string, provider: DemoProvider, range: DateRange): string {
  return `${slugifyForFilename(workspaceName)}-${provider}-campaigns-${range.since}-to-${range.until}.csv`;
}

const CSV_HEADERS = [
  "Campaign",
  "Status",
  "Spend",
  "Revenue",
  "ROAS",
  "Purchases",
  "CPA",
  "CPC",
  "CPM",
  "CTR (%)",
  "Impressions",
  "Clicks",
  "Frequency",
  "Quality ranking",
  "Engagement rate ranking",
  "Conversion rate ranking",
];

const toMajor = (minor: number): string => (minor / 100).toFixed(2);

/**
 * Plain CSV text (RFC 4180) mirroring the Campaigns table on the ads
 * report. Money is decimal major units (not minor/paise) — a spreadsheet
 * is for further math, not display formatting, so raw precision beats the
 * UI's abbreviated "₹1.2L" style here.
 */
export function campaignsToCsv(campaigns: CampaignWithFacts[]): string {
  const rows = [csvRow(CSV_HEADERS)];
  for (const c of campaigns) {
    const f = c.facts;
    rows.push(
      csvRow([
        c.name,
        c.status,
        toMajor(f.spendMinor),
        toMajor(f.revenueMinor),
        adMetrics.roas(f).toFixed(2),
        f.purchases,
        toMajor(adMetrics.cpa(f)),
        toMajor(adMetrics.cpc(f)),
        toMajor(adMetrics.cpm(f)),
        (adMetrics.ctr(f) * 100).toFixed(2),
        f.impressions,
        f.clicks,
        adMetrics.frequency(f).toFixed(2),
        c.qualityRanking ?? "",
        c.engagementRateRanking ?? "",
        c.conversionRateRanking ?? "",
      ]),
    );
  }
  return csvDocument(rows);
}
