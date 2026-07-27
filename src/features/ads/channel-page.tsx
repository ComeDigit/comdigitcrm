import { Topbar } from "@/components/shell/topbar";
import { KpiCard } from "@/components/charts/kpi-card";
import { DateRangePicker } from "@/components/charts/date-range-picker";
import { MoneyAreaChart } from "@/components/charts/charts";
import { Card, CardHeader, Badge } from "@/components/ui/primitives";
import {
  getAdDaily,
  getCampaignsWithFacts,
  previousPeriod,
  resolveDateRange,
  formatRangeLabel,
  type DateRange,
  type RangePreset,
  type CampaignWithFacts,
} from "@/features/metrics/queries";
import { getLiveMetaReport, getMetaPacing } from "@/features/integrations/meta-live";
import { getLiveMetaAdSets, getLiveMetaAds, getLiveMetaAudience } from "@/features/integrations/meta-breakdowns-live";
import type {
  MetaAdSetInsight,
  MetaAdInsight,
  MetaAgeGenderInsight,
  MetaCountryInsight,
} from "@/features/integrations/meta-breakdowns";
import { getLiveGoogleAdsReport, getGoogleAdsPacing } from "@/features/integrations/google-ads-live";
import {
  getLiveGoogleAdsKeywords,
  getLiveGoogleAdsSearchTerms,
  getLiveGoogleAdsAudience,
} from "@/features/integrations/google-ads-breakdowns-live";
import type {
  GoogleAdsKeywordInsight,
  GoogleAdsSearchTermInsight,
  GoogleAdsDeviceInsight,
  GoogleAdsLocationInsight,
} from "@/features/integrations/google-ads-breakdowns";
import { getLiveTikTokReport, getTikTokPacing } from "@/features/integrations/tiktok-live";
import { adMetrics, sumAdFacts, type AdFacts } from "@/lib/metrics/definitions";
import type { DemoProvider } from "@/features/demo-data/generator";
import { formatMoney, formatNumber, formatPercent } from "@/lib/utils";
import { getActiveWorkspaceId, getWorkspaceName } from "@/lib/workspace";
import { isDemoMode } from "@/lib/env";

type ReportSearchParams = Promise<{ preset?: string; since?: string; until?: string }>;

/**
 * The read-only report body — KPI grid + spend/revenue chart + campaign
 * table — with NO Topbar and NO workspace switcher. Takes workspaceId
 * explicitly rather than reading it from the "ws" cookie, so it renders
 * identically for an internal dashboard route (current cookie-selected
 * workspace) and a public share link (one fixed workspace baked into the
 * share token, with no cross-workspace navigation exposed to strangers).
 * `AdsChannelPage` below and the public /share/meta/[token] route are the
 * only two callers — never duplicate this markup a third time.
 */
export async function AdsReport({
  workspaceId,
  provider,
  label,
  range,
  preset,
}: {
  workspaceId: string;
  provider: DemoProvider;
  label: string;
  range: DateRange;
  preset: RangePreset;
}) {
  const rangeLabel = formatRangeLabel(range, preset);

  let totals: AdFacts;
  let prev: AdFacts;
  let trend: Array<{ date: string; spend: number; revenue: number }>;
  let campaigns: CampaignWithFacts[];
  let partialFailure = false;
  let failures: Array<{ displayName: string; reason: string }> = [];
  let pacing: { activeDailyBudgetMinor: number; spendTodayMinor: number } | null = null;
  // Meta-only deeper breakdowns (AUDIT_REPORT.md High: ad set/ad level +
  // audience breakdown) — stay empty for every other provider and for demo
  // mode, same as `pacing` above.
  let adSets: MetaAdSetInsight[] = [];
  let ads: MetaAdInsight[] = [];
  let byAgeGender: MetaAgeGenderInsight[] = [];
  let byCountry: MetaCountryInsight[] = [];
  // Google-Ads-only deeper breakdowns (AUDIT_REPORT.md High: keyword/
  // search-term/device/location reporting) — same story, empty elsewhere.
  let googleKeywords: GoogleAdsKeywordInsight[] = [];
  let googleSearchTerms: GoogleAdsSearchTermInsight[] = [];
  let googleByDevice: GoogleAdsDeviceInsight[] = [];
  let googleByLocation: GoogleAdsLocationInsight[] = [];

  // All three ad channels are on-demand/live per client instruction — no
  // local historical storage for any of them. Two live pulls (current +
  // previous period) so the delta comparisons on every card keep working;
  // a few extra API calls per page view is an accepted trade-off (see
  // meta-live.ts / google-ads-live.ts / tiktok-live.ts). Pacing is always
  // about today regardless of the selected range, so it's a separate
  // fetch. Kept as one block per provider (rather than a generic dispatch
  // table) so each live-report/pacing pair's types stay concrete.
  if (provider === "meta" && !isDemoMode) {
    const [current, previous, pacingResult, adSetsResult, adsResult, audienceResult] = await Promise.all([
      getLiveMetaReport(workspaceId, range),
      getLiveMetaReport(workspaceId, previousPeriod(range)),
      getMetaPacing(workspaceId),
      getLiveMetaAdSets(workspaceId, range),
      getLiveMetaAds(workspaceId, range),
      getLiveMetaAudience(workspaceId, range),
    ]);
    totals = current.totals;
    prev = previous.totals;
    trend = current.trend.map((t) => ({ date: t.date, spend: t.spendMinor, revenue: t.revenueMinor }));
    campaigns = current.campaigns;
    adSets = adSetsResult.adSets;
    ads = adsResult.ads;
    byAgeGender = audienceResult.byAgeGender;
    byCountry = audienceResult.byCountry;
    partialFailure =
      current.partialFailure ||
      previous.partialFailure ||
      pacingResult.partialFailure ||
      adSetsResult.partialFailure ||
      adsResult.partialFailure ||
      audienceResult.partialFailure;
    // Every one of these calls shares the same connections/credentials, so
    // a bad token surfaces in all of them at once — de-duped by display
    // name so the banner lists each broken account once, not up to 6 times.
    const seenFailures = new Set<string>();
    failures = [];
    for (const list of [current.failures, adSetsResult.failures, adsResult.failures, audienceResult.failures]) {
      for (const f of list) {
        if (!seenFailures.has(f.displayName)) {
          seenFailures.add(f.displayName);
          failures.push(f);
        }
      }
    }
    pacing = pacingResult;
  } else if (provider === "google_ads" && !isDemoMode) {
    const [current, previous, pacingResult, keywordsResult, searchTermsResult, audienceResult] = await Promise.all([
      getLiveGoogleAdsReport(workspaceId, range),
      getLiveGoogleAdsReport(workspaceId, previousPeriod(range)),
      getGoogleAdsPacing(workspaceId),
      getLiveGoogleAdsKeywords(workspaceId, range),
      getLiveGoogleAdsSearchTerms(workspaceId, range),
      getLiveGoogleAdsAudience(workspaceId, range),
    ]);
    totals = current.totals;
    prev = previous.totals;
    trend = current.trend.map((t) => ({ date: t.date, spend: t.spendMinor, revenue: t.revenueMinor }));
    campaigns = current.campaigns;
    googleKeywords = keywordsResult.keywords;
    googleSearchTerms = searchTermsResult.searchTerms;
    googleByDevice = audienceResult.byDevice;
    googleByLocation = audienceResult.byLocation;
    partialFailure =
      current.partialFailure ||
      previous.partialFailure ||
      pacingResult.partialFailure ||
      keywordsResult.partialFailure ||
      searchTermsResult.partialFailure ||
      audienceResult.partialFailure;
    // Same story as the Meta branch above — every one of these shares the
    // same connections/credentials, so de-dupe by display name.
    const seenGoogleFailures = new Set<string>();
    failures = [];
    for (const list of [current.failures, keywordsResult.failures, searchTermsResult.failures, audienceResult.failures]) {
      for (const f of list) {
        if (!seenGoogleFailures.has(f.displayName)) {
          seenGoogleFailures.add(f.displayName);
          failures.push(f);
        }
      }
    }
    pacing = pacingResult;
  } else if (provider === "tiktok" && !isDemoMode) {
    const [current, previous, pacingResult] = await Promise.all([
      getLiveTikTokReport(workspaceId, range),
      getLiveTikTokReport(workspaceId, previousPeriod(range)),
      getTikTokPacing(workspaceId),
    ]);
    totals = current.totals;
    prev = previous.totals;
    trend = current.trend.map((t) => ({ date: t.date, spend: t.spendMinor, revenue: t.revenueMinor }));
    campaigns = current.campaigns;
    partialFailure = current.partialFailure || previous.partialFailure || pacingResult.partialFailure;
    failures = current.failures;
    pacing = pacingResult;
  } else {
    // Demo mode only reaches here now — every real provider has a live
    // branch above.
    const [rows, prevRows, dbCampaigns] = await Promise.all([
      getAdDaily(workspaceId, range, [provider]),
      getAdDaily(workspaceId, previousPeriod(range), [provider]),
      getCampaignsWithFacts(workspaceId, provider, range),
    ]);
    totals = sumAdFacts(rows);
    prev = sumAdFacts(prevRows);
    trend = rows
      .map((r) => ({ date: r.date, spend: r.spendMinor, revenue: r.revenueMinor }))
      .sort((a, b) => a.date.localeCompare(b.date));
    campaigns = dbCampaigns;
  }

  const deltaOf = (curr: number, p: number) => (p > 0 ? (curr - p) / p : 0);
  const metricDelta = (fn: (f: AdFacts) => number, invert = false) => {
    const d = deltaOf(fn(totals), fn(prev));
    return invert ? -d : d;
  };

  campaigns.sort((a, b) => b.facts.spendMinor - a.facts.spendMinor);
  adSets.sort((a, b) => b.facts.spendMinor - a.facts.spendMinor);
  ads.sort((a, b) => b.facts.spendMinor - a.facts.spendMinor);
  // Friendly names in the ad set / ad tables below instead of raw Meta IDs.
  const campaignNameById = new Map(campaigns.map((c) => [c.id, c.name]));
  const adSetNameById = new Map(adSets.map((a) => [a.id, a.name]));
  // Ad sets/ads aren't capped server-side (unlike the top-25 country
  // breakdown) since a typical account has far fewer of them than
  // countries — but a handful of large accounts can still return hundreds,
  // so the table itself caps to the top 50 by spend rather than rendering
  // an unbounded page.
  const AD_ENTITY_DISPLAY_CAP = 50;
  const adSetsShown = adSets.slice(0, AD_ENTITY_DISPLAY_CAP);
  const adsShown = ads.slice(0, AD_ENTITY_DISPLAY_CAP);

  // Google keywords/search terms are already capped to 50 per connection
  // by the GAQL query itself (see google-ads-breakdowns.ts) — but a
  // workspace with more than one connected Google Ads account can still
  // exceed 50 once flat-concatenated, so re-sort + re-cap the combined list
  // the same way as adSets/ads above.
  googleKeywords.sort((a, b) => b.facts.spendMinor - a.facts.spendMinor);
  googleSearchTerms.sort((a, b) => b.facts.spendMinor - a.facts.spendMinor);
  const googleKeywordsShown = googleKeywords.slice(0, AD_ENTITY_DISPLAY_CAP);
  const googleSearchTermsShown = googleSearchTerms.slice(0, AD_ENTITY_DISPLAY_CAP);

  /**
   * Trimmed to the 4 most-used cards per group (was ~35 cards across 4
   * groups) — per client request, less scrolling for the numbers people
   * actually check day to day. The full set of underlying metrics is still
   * computed and available in `adMetrics`/`totals` if these need expanding
   * again later.
   */
  type Kpi = { label: string; value: string; delta?: number; hint?: string; info: string };
  const overviewKpis: Kpi[] = [
    { label: "Spend", value: formatMoney(totals.spendMinor), delta: deltaOf(totals.spendMinor, prev.spendMinor), info: `Total money paid to ${label} to run ads this period.` },
    { label: "Revenue", value: formatMoney(totals.revenueMinor), delta: deltaOf(totals.revenueMinor, prev.revenueMinor), info: `Revenue ${label} reports as coming from its own ads (its own tracking).` },
    { label: "ROAS", value: `${adMetrics.roas(totals).toFixed(2)}x`, delta: metricDelta(adMetrics.roas), info: "Return On Ad Spend — revenue earned per ₹1 spent. Above 1x means the ads paid for themselves; higher is better." },
    { label: "Purchases", value: formatNumber(totals.purchases), delta: deltaOf(totals.purchases, prev.purchases), info: "Number of purchases attributed to these ads." },
  ];

  const clicksKpis: Kpi[] = [
    { label: "Outbound clicks", value: formatNumber(totals.outboundClicks), delta: deltaOf(totals.outboundClicks, prev.outboundClicks), info: "Clicks that sent someone away from the platform to the advertiser's website." },
    { label: "Outbound CTR", value: formatPercent(adMetrics.outboundCtr(totals), 2), delta: metricDelta(adMetrics.outboundCtr), info: "Share of impressions that resulted in an outbound click to the website." },
    { label: "Landing page views", value: formatNumber(totals.landingPageViews), delta: deltaOf(totals.landingPageViews, prev.landingPageViews), info: "Number of times the linked page actually finished loading after a click." },
    { label: "Cost / landing page view", value: formatMoney(adMetrics.costPerLandingPageView(totals)), delta: metricDelta(adMetrics.costPerLandingPageView, true), hint: "Lower is better", info: "Average ad spend needed for one person to land on a fully-loaded page." },
  ];

  const videoKpis: Kpi[] = [
    { label: "Video views (3s)", value: formatNumber(totals.videoViews3s), delta: deltaOf(totals.videoViews3s, prev.videoViews3s), info: "Number of times the video was watched for at least 3 seconds." },
    { label: "Hook rate", value: formatPercent(adMetrics.hookRate(totals)), delta: metricDelta(adMetrics.hookRate), hint: "3s video views ÷ impressions", info: "Of everyone who saw the video ad, what share watched at least 3 seconds — a sign the opening is grabbing attention." },
    { label: "Thruplays", value: formatNumber(totals.videoThruplays), delta: deltaOf(totals.videoThruplays, prev.videoThruplays), info: "Number of times the video played to completion, or for at least 15 seconds if longer." },
    { label: "Cost / thruplay", value: formatMoney(adMetrics.costPerThruplay(totals)), delta: metricDelta(adMetrics.costPerThruplay, true), hint: "Lower is better", info: "Average ad spend needed for one full (or 15s+) video view." },
  ];

  const funnelKpis: Kpi[] = [
    { label: "Add to cart", value: formatNumber(totals.addToCart), delta: deltaOf(totals.addToCart, prev.addToCart), info: "Number of times someone added a product to their cart." },
    { label: "Initiate checkout", value: formatNumber(totals.initiateCheckout), delta: deltaOf(totals.initiateCheckout, prev.initiateCheckout), info: "Number of times someone started the checkout process." },
    { label: "Leads", value: formatNumber(totals.leads), delta: deltaOf(totals.leads, prev.leads), info: "Number of leads (form fills, sign-ups, etc.) attributed to these ads." },
    { label: "Cost / lead", value: formatMoney(adMetrics.costPerLead(totals)), delta: metricDelta(adMetrics.costPerLead, true), hint: "Lower is better", info: "Average ad spend needed for one lead." },
  ];

  const kpiGroups: Array<{ title: string; subtitle: string; items: Kpi[] }> = [
    { title: "Overview", subtitle: `${rangeLabel} · vs previous period`, items: overviewKpis },
    { title: "Clicks & landing", subtitle: "Off-platform engagement", items: clicksKpis },
    { title: "Video", subtitle: "Watch-through funnel", items: videoKpis },
    { title: "Conversion funnel", subtitle: "Product → purchase, each step with its own cost", items: funnelKpis },
  ];

  if (pacing) {
    const pacingPct = pacing.activeDailyBudgetMinor > 0
      ? pacing.spendTodayMinor / pacing.activeDailyBudgetMinor
      : 0;
    const pacingKpis: Kpi[] = [
      { label: "Active daily budget", value: formatMoney(pacing.activeDailyBudgetMinor), info: "Total daily budget across every campaign that's currently active — what you're set up to spend today if everything runs at full budget." },
      { label: "Spent today", value: formatMoney(pacing.spendTodayMinor), info: `Actual spend so far today, across every active ${label} account — resets at midnight.` },
      { label: "Pacing", value: formatPercent(pacingPct), hint: "Spent today ÷ active daily budget", info: "How much of today's active budget has been spent so far. Well under 100% partway through the day is normal; if it's near or over 100% early in the day, campaigns may exhaust budget before midnight." },
    ];
    kpiGroups.push({
      title: "Pacing",
      subtitle: "Today only — independent of the date range above",
      items: pacingKpis,
    });
  }

  const th = "px-3 py-2 text-right font-medium whitespace-nowrap";
  const td = "px-3 py-2.5 text-right tabular-nums whitespace-nowrap";

  /** Meta's three campaign-grain quality signals — coloured so a below-average
   * ranking is easy to spot without reading the label. */
  const rankTone = (rank?: string | null): "positive" | "neutral" | "negative" | "outline" => {
    if (rank === "above_average") return "positive";
    if (rank === "below_average") return "negative";
    if (rank === "average") return "neutral";
    return "outline";
  };
  const rankLabel = (rank?: string | null) => (rank ? rank.replace(/_/g, " ") : "—");

  /** Google's segments.device enum values, in the friendly form Google's
   *  own UI uses — CONNECTED_TV in particular reads badly as raw text. */
  const deviceLabels: Record<string, string> = {
    MOBILE: "Mobile",
    DESKTOP: "Desktop",
    TABLET: "Tablet",
    CONNECTED_TV: "Connected TV",
    OTHER: "Other",
  };
  const deviceLabel = (d: string) => deviceLabels[d] ?? d.replace(/_/g, " ");
  const matchTypeLabel = (m: string) => (m ? m.charAt(0) + m.slice(1).toLowerCase() : "—");

  return (
    <main className="space-y-6 px-6 py-6">
        <DateRangePicker preset={preset} range={range} />

        {partialFailure ? (
          <div className="rounded-lg border border-negative/30 bg-negative/10 px-4 py-2.5 text-xs text-negative">
            <p>
              Couldn&apos;t reach {failures.length === 1 ? `one connected ${label} account` : `${failures.length || "one or more"} connected ${label} account(s)`} just now —
              numbers below may be incomplete. This report is pulled live on every page view, so
              refreshing may resolve it.
            </p>
            {failures.length > 0 ? (
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {failures.map((f, i) => (
                  <li key={`${f.displayName}-${i}`}>
                    <span className="font-medium">{f.displayName}:</span> {f.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-5">
          <p className="text-xs font-medium uppercase tracking-widest text-muted">
            {rangeLabel} · vs previous period · hover the ⓘ on any card for a plain-English explanation
          </p>
          {kpiGroups.map((group) => (
            <div key={group.title}>
              <p className="mb-2 text-sm font-semibold">
                {group.title} <span className="font-normal text-muted">· {group.subtitle}</span>
              </p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
                {group.items.map((k) => (
                  <KpiCard key={k.label} label={k.label} value={k.value} delta={k.delta} hint={k.hint} info={k.info} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <Card>
          <CardHeader title="Spend vs attributed revenue" subtitle={`Daily, ${rangeLabel}`} />
          <div className="px-3 pb-4">
            <MoneyAreaChart
              data={trend}
              series={[
                { key: "revenue", label: "Revenue" },
                { key: "spend", label: "Spend" },
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Campaigns"
            subtitle={`${rangeLabel} · all key KPIs per campaign · sorted by spend`}
          />
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Campaign</th>
                  <th className={th}>Spend</th>
                  <th className={th}>Revenue</th>
                  <th className={th}>ROAS</th>
                  <th className={th}>Purchases</th>
                  <th className={th}>CPA</th>
                  <th className={th}>CPC</th>
                  <th className={th}>CPM</th>
                  <th className={th}>CTR</th>
                  <th className={th}>Impressions</th>
                  <th className={th}>Clicks</th>
                  <th className={th}>Freq</th>
                  <th className={th} title="Quality / engagement / conversion rate rankings">Rankings</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-3 py-6 text-center text-xs text-muted">
                      {!isDemoMode
                        ? `No campaigns found for this date range — connect a ${label} account in Settings, or try a wider date range.`
                        : "No campaigns synced for this client yet — connect an ad account in Settings and wait for the first sync to complete."}
                    </td>
                  </tr>
                ) : null}
                {campaigns.map((c) => {
                  const f = c.facts;
                  const roas = adMetrics.roas(f);
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-border/60 last:border-0 hover:bg-surface-2/60"
                    >
                      <td className="max-w-[260px] truncate px-3 py-2.5 font-medium">
                        {c.name}
                      </td>
                      <td className={td}>{formatMoney(f.spendMinor)}</td>
                      <td className={td}>{formatMoney(f.revenueMinor)}</td>
                      <td className={td}>
                        <span className={roas >= 2 ? "text-positive" : "text-negative"}>
                          {roas.toFixed(2)}x
                        </span>
                      </td>
                      <td className={td}>{formatNumber(f.purchases)}</td>
                      <td className={td}>{formatMoney(adMetrics.cpa(f))}</td>
                      <td className={td}>{formatMoney(adMetrics.cpc(f))}</td>
                      <td className={td}>{formatMoney(adMetrics.cpm(f))}</td>
                      <td className={td}>{formatPercent(adMetrics.ctr(f), 2)}</td>
                      <td className={td}>{formatNumber(f.impressions)}</td>
                      <td className={td}>{formatNumber(f.clicks)}</td>
                      <td className={td}>{adMetrics.frequency(f).toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Badge tone={rankTone(c.qualityRanking)} title={`Quality ranking: ${rankLabel(c.qualityRanking)}`}>
                            Q: {rankLabel(c.qualityRanking)}
                          </Badge>
                          <Badge tone={rankTone(c.engagementRateRanking)} title={`Engagement rate ranking: ${rankLabel(c.engagementRateRanking)}`}>
                            E: {rankLabel(c.engagementRateRanking)}
                          </Badge>
                          <Badge tone={rankTone(c.conversionRateRanking)} title={`Conversion rate ranking: ${rankLabel(c.conversionRateRanking)}`}>
                            C: {rankLabel(c.conversionRateRanking)}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Badge tone={c.status === "active" ? "positive" : "outline"}>
                          {c.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {provider === "meta" && !isDemoMode ? (
          <>
            <Card>
              <CardHeader
                title="Ad sets"
                subtitle={
                  adSets.length > AD_ENTITY_DISPLAY_CAP
                    ? `${rangeLabel} · showing top ${AD_ENTITY_DISPLAY_CAP} of ${adSets.length} by spend`
                    : `${rangeLabel} · all key KPIs per ad set · sorted by spend`
                }
              />
              <div className="overflow-x-auto px-2 pb-3">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-3 py-2 font-medium">Ad set</th>
                      <th className="px-3 py-2 font-medium">Campaign</th>
                      <th className={th}>Spend</th>
                      <th className={th}>Revenue</th>
                      <th className={th}>ROAS</th>
                      <th className={th}>Purchases</th>
                      <th className={th}>CPA</th>
                      <th className={th}>CPC</th>
                      <th className={th}>CPM</th>
                      <th className={th}>CTR</th>
                      <th className={th}>Impressions</th>
                      <th className={th}>Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adSetsShown.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-3 py-6 text-center text-xs text-muted">
                          {`No ad sets found for this date range — connect a ${label} account in Settings, or try a wider date range.`}
                        </td>
                      </tr>
                    ) : null}
                    {adSetsShown.map((a) => {
                      const f = a.facts;
                      const roas = adMetrics.roas(f);
                      return (
                        <tr key={a.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                          <td className="max-w-[220px] truncate px-3 py-2.5 font-medium">{a.name}</td>
                          <td className="max-w-[220px] truncate px-3 py-2.5 text-muted">
                            {campaignNameById.get(a.campaignId) ?? a.campaignId}
                          </td>
                          <td className={td}>{formatMoney(f.spendMinor)}</td>
                          <td className={td}>{formatMoney(f.revenueMinor)}</td>
                          <td className={td}>
                            <span className={roas >= 2 ? "text-positive" : "text-negative"}>{roas.toFixed(2)}x</span>
                          </td>
                          <td className={td}>{formatNumber(f.purchases)}</td>
                          <td className={td}>{formatMoney(adMetrics.cpa(f))}</td>
                          <td className={td}>{formatMoney(adMetrics.cpc(f))}</td>
                          <td className={td}>{formatMoney(adMetrics.cpm(f))}</td>
                          <td className={td}>{formatPercent(adMetrics.ctr(f), 2)}</td>
                          <td className={td}>{formatNumber(f.impressions)}</td>
                          <td className={td}>{formatNumber(f.clicks)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Ads"
                subtitle={
                  ads.length > AD_ENTITY_DISPLAY_CAP
                    ? `${rangeLabel} · showing top ${AD_ENTITY_DISPLAY_CAP} of ${ads.length} by spend`
                    : `${rangeLabel} · all key KPIs per ad · sorted by spend`
                }
              />
              <div className="overflow-x-auto px-2 pb-3">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-3 py-2 font-medium">Ad</th>
                      <th className="px-3 py-2 font-medium">Ad set</th>
                      <th className={th}>Spend</th>
                      <th className={th}>Revenue</th>
                      <th className={th}>ROAS</th>
                      <th className={th}>Purchases</th>
                      <th className={th}>CPA</th>
                      <th className={th}>CPC</th>
                      <th className={th}>CPM</th>
                      <th className={th}>CTR</th>
                      <th className={th}>Impressions</th>
                      <th className={th}>Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adsShown.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-3 py-6 text-center text-xs text-muted">
                          {`No ads found for this date range — connect a ${label} account in Settings, or try a wider date range.`}
                        </td>
                      </tr>
                    ) : null}
                    {adsShown.map((a) => {
                      const f = a.facts;
                      const roas = adMetrics.roas(f);
                      return (
                        <tr key={a.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                          <td className="max-w-[220px] truncate px-3 py-2.5 font-medium">{a.name}</td>
                          <td className="max-w-[220px] truncate px-3 py-2.5 text-muted">
                            {adSetNameById.get(a.adsetId) ?? a.adsetId}
                          </td>
                          <td className={td}>{formatMoney(f.spendMinor)}</td>
                          <td className={td}>{formatMoney(f.revenueMinor)}</td>
                          <td className={td}>
                            <span className={roas >= 2 ? "text-positive" : "text-negative"}>{roas.toFixed(2)}x</span>
                          </td>
                          <td className={td}>{formatNumber(f.purchases)}</td>
                          <td className={td}>{formatMoney(adMetrics.cpa(f))}</td>
                          <td className={td}>{formatMoney(adMetrics.cpc(f))}</td>
                          <td className={td}>{formatMoney(adMetrics.cpm(f))}</td>
                          <td className={td}>{formatPercent(adMetrics.ctr(f), 2)}</td>
                          <td className={td}>{formatNumber(f.impressions)}</td>
                          <td className={td}>{formatNumber(f.clicks)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader title="Audience — age & gender" subtitle={`${rangeLabel} · sorted by spend`} />
              <div className="overflow-x-auto px-2 pb-3">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-3 py-2 font-medium">Age</th>
                      <th className="px-3 py-2 font-medium">Gender</th>
                      <th className={th}>Spend</th>
                      <th className={th}>Revenue</th>
                      <th className={th}>ROAS</th>
                      <th className={th}>Purchases</th>
                      <th className={th}>CPA</th>
                      <th className={th}>Impressions</th>
                      <th className={th}>Clicks</th>
                      <th className={th}>CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byAgeGender.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-3 py-6 text-center text-xs text-muted">
                          {`No audience data for this date range — connect a ${label} account in Settings, or try a wider date range.`}
                        </td>
                      </tr>
                    ) : null}
                    {byAgeGender.map((row) => {
                      const f = row.facts;
                      const roas = adMetrics.roas(f);
                      return (
                        <tr
                          key={`${row.age}-${row.gender}`}
                          className="border-b border-border/60 last:border-0 hover:bg-surface-2/60"
                        >
                          <td className="px-3 py-2.5 font-medium">{row.age}</td>
                          <td className="px-3 py-2.5 capitalize text-muted">{row.gender}</td>
                          <td className={td}>{formatMoney(f.spendMinor)}</td>
                          <td className={td}>{formatMoney(f.revenueMinor)}</td>
                          <td className={td}>
                            <span className={roas >= 2 ? "text-positive" : "text-negative"}>{roas.toFixed(2)}x</span>
                          </td>
                          <td className={td}>{formatNumber(f.purchases)}</td>
                          <td className={td}>{formatMoney(adMetrics.cpa(f))}</td>
                          <td className={td}>{formatNumber(f.impressions)}</td>
                          <td className={td}>{formatNumber(f.clicks)}</td>
                          <td className={td}>{formatPercent(adMetrics.ctr(f), 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Audience — country"
                subtitle={`${rangeLabel} · sorted by spend${byCountry.length >= 25 ? " · top 25 shown" : ""}`}
              />
              <div className="overflow-x-auto px-2 pb-3">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-3 py-2 font-medium">Country</th>
                      <th className={th}>Spend</th>
                      <th className={th}>Revenue</th>
                      <th className={th}>ROAS</th>
                      <th className={th}>Purchases</th>
                      <th className={th}>CPA</th>
                      <th className={th}>Impressions</th>
                      <th className={th}>Clicks</th>
                      <th className={th}>CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCountry.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-xs text-muted">
                          {`No audience data for this date range — connect a ${label} account in Settings, or try a wider date range.`}
                        </td>
                      </tr>
                    ) : null}
                    {byCountry.map((row) => {
                      const f = row.facts;
                      const roas = adMetrics.roas(f);
                      return (
                        <tr key={row.country} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                          <td className="px-3 py-2.5 font-medium">{row.country}</td>
                          <td className={td}>{formatMoney(f.spendMinor)}</td>
                          <td className={td}>{formatMoney(f.revenueMinor)}</td>
                          <td className={td}>
                            <span className={roas >= 2 ? "text-positive" : "text-negative"}>{roas.toFixed(2)}x</span>
                          </td>
                          <td className={td}>{formatNumber(f.purchases)}</td>
                          <td className={td}>{formatMoney(adMetrics.cpa(f))}</td>
                          <td className={td}>{formatNumber(f.impressions)}</td>
                          <td className={td}>{formatNumber(f.clicks)}</td>
                          <td className={td}>{formatPercent(adMetrics.ctr(f), 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : null}

        {provider === "google_ads" && !isDemoMode ? (
          <>
            <Card>
              <CardHeader
                title="Keywords"
                subtitle={`${rangeLabel} · top ${AD_ENTITY_DISPLAY_CAP} by spend`}
              />
              <div className="overflow-x-auto px-2 pb-3">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-3 py-2 font-medium">Keyword</th>
                      <th className="px-3 py-2 font-medium">Match type</th>
                      <th className="px-3 py-2 font-medium">Ad group</th>
                      <th className={th}>Spend</th>
                      <th className={th}>Revenue</th>
                      <th className={th}>ROAS</th>
                      <th className={th}>Purchases</th>
                      <th className={th}>CPA</th>
                      <th className={th}>CPC</th>
                      <th className={th}>CPM</th>
                      <th className={th}>CTR</th>
                      <th className={th}>Impressions</th>
                      <th className={th}>Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {googleKeywordsShown.length === 0 ? (
                      <tr>
                        <td colSpan={13} className="px-3 py-6 text-center text-xs text-muted">
                          {`No keywords found for this date range — connect a ${label} account in Settings, or try a wider date range.`}
                        </td>
                      </tr>
                    ) : null}
                    {googleKeywordsShown.map((k) => {
                      const f = k.facts;
                      const roas = adMetrics.roas(f);
                      return (
                        <tr key={k.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                          <td className="max-w-[220px] truncate px-3 py-2.5 font-medium">{k.text}</td>
                          <td className="px-3 py-2.5 text-muted">{matchTypeLabel(k.matchType)}</td>
                          <td className="max-w-[180px] truncate px-3 py-2.5 text-muted">{k.adGroupName}</td>
                          <td className={td}>{formatMoney(f.spendMinor)}</td>
                          <td className={td}>{formatMoney(f.revenueMinor)}</td>
                          <td className={td}>
                            <span className={roas >= 2 ? "text-positive" : "text-negative"}>{roas.toFixed(2)}x</span>
                          </td>
                          <td className={td}>{formatNumber(f.purchases)}</td>
                          <td className={td}>{formatMoney(adMetrics.cpa(f))}</td>
                          <td className={td}>{formatMoney(adMetrics.cpc(f))}</td>
                          <td className={td}>{formatMoney(adMetrics.cpm(f))}</td>
                          <td className={td}>{formatPercent(adMetrics.ctr(f), 2)}</td>
                          <td className={td}>{formatNumber(f.impressions)}</td>
                          <td className={td}>{formatNumber(f.clicks)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Search terms"
                subtitle={`${rangeLabel} · top ${AD_ENTITY_DISPLAY_CAP} by spend · what people actually typed`}
              />
              <div className="overflow-x-auto px-2 pb-3">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-3 py-2 font-medium">Search term</th>
                      <th className="px-3 py-2 font-medium">Ad group</th>
                      <th className={th}>Spend</th>
                      <th className={th}>Revenue</th>
                      <th className={th}>ROAS</th>
                      <th className={th}>Purchases</th>
                      <th className={th}>CPA</th>
                      <th className={th}>CPC</th>
                      <th className={th}>CPM</th>
                      <th className={th}>CTR</th>
                      <th className={th}>Impressions</th>
                      <th className={th}>Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {googleSearchTermsShown.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-3 py-6 text-center text-xs text-muted">
                          {`No search terms found for this date range — connect a ${label} account in Settings, or try a wider date range.`}
                        </td>
                      </tr>
                    ) : null}
                    {googleSearchTermsShown.map((s) => {
                      const f = s.facts;
                      const roas = adMetrics.roas(f);
                      return (
                        <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                          <td className="max-w-[220px] truncate px-3 py-2.5 font-medium">{s.searchTerm}</td>
                          <td className="max-w-[180px] truncate px-3 py-2.5 text-muted">{s.adGroupName}</td>
                          <td className={td}>{formatMoney(f.spendMinor)}</td>
                          <td className={td}>{formatMoney(f.revenueMinor)}</td>
                          <td className={td}>
                            <span className={roas >= 2 ? "text-positive" : "text-negative"}>{roas.toFixed(2)}x</span>
                          </td>
                          <td className={td}>{formatNumber(f.purchases)}</td>
                          <td className={td}>{formatMoney(adMetrics.cpa(f))}</td>
                          <td className={td}>{formatMoney(adMetrics.cpc(f))}</td>
                          <td className={td}>{formatMoney(adMetrics.cpm(f))}</td>
                          <td className={td}>{formatPercent(adMetrics.ctr(f), 2)}</td>
                          <td className={td}>{formatNumber(f.impressions)}</td>
                          <td className={td}>{formatNumber(f.clicks)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader title="Device" subtitle={`${rangeLabel} · sorted by spend`} />
              <div className="overflow-x-auto px-2 pb-3">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-3 py-2 font-medium">Device</th>
                      <th className={th}>Spend</th>
                      <th className={th}>Revenue</th>
                      <th className={th}>ROAS</th>
                      <th className={th}>Purchases</th>
                      <th className={th}>CPA</th>
                      <th className={th}>Impressions</th>
                      <th className={th}>Clicks</th>
                      <th className={th}>CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {googleByDevice.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-xs text-muted">
                          {`No device data for this date range — connect a ${label} account in Settings, or try a wider date range.`}
                        </td>
                      </tr>
                    ) : null}
                    {googleByDevice.map((row) => {
                      const f = row.facts;
                      const roas = adMetrics.roas(f);
                      return (
                        <tr key={row.device} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                          <td className="px-3 py-2.5 font-medium">{deviceLabel(row.device)}</td>
                          <td className={td}>{formatMoney(f.spendMinor)}</td>
                          <td className={td}>{formatMoney(f.revenueMinor)}</td>
                          <td className={td}>
                            <span className={roas >= 2 ? "text-positive" : "text-negative"}>{roas.toFixed(2)}x</span>
                          </td>
                          <td className={td}>{formatNumber(f.purchases)}</td>
                          <td className={td}>{formatMoney(adMetrics.cpa(f))}</td>
                          <td className={td}>{formatNumber(f.impressions)}</td>
                          <td className={td}>{formatNumber(f.clicks)}</td>
                          <td className={td}>{formatPercent(adMetrics.ctr(f), 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Location — country"
                subtitle={`${rangeLabel} · sorted by spend${googleByLocation.length >= 25 ? " · top 25 shown" : ""}`}
              />
              <div className="overflow-x-auto px-2 pb-3">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="px-3 py-2 font-medium">Country</th>
                      <th className={th}>Spend</th>
                      <th className={th}>Revenue</th>
                      <th className={th}>ROAS</th>
                      <th className={th}>Purchases</th>
                      <th className={th}>CPA</th>
                      <th className={th}>Impressions</th>
                      <th className={th}>Clicks</th>
                      <th className={th}>CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {googleByLocation.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-xs text-muted">
                          {`No location data for this date range — connect a ${label} account in Settings, or try a wider date range.`}
                        </td>
                      </tr>
                    ) : null}
                    {googleByLocation.map((row) => {
                      const f = row.facts;
                      const roas = adMetrics.roas(f);
                      return (
                        <tr
                          key={row.countryCriterionId}
                          className="border-b border-border/60 last:border-0 hover:bg-surface-2/60"
                        >
                          <td className="px-3 py-2.5 font-medium" title={`Google location ID ${row.countryCriterionId}`}>
                            {row.countryCode ?? `#${row.countryCriterionId}`}
                          </td>
                          <td className={td}>{formatMoney(f.spendMinor)}</td>
                          <td className={td}>{formatMoney(f.revenueMinor)}</td>
                          <td className={td}>
                            <span className={roas >= 2 ? "text-positive" : "text-negative"}>{roas.toFixed(2)}x</span>
                          </td>
                          <td className={td}>{formatNumber(f.purchases)}</td>
                          <td className={td}>{formatMoney(adMetrics.cpa(f))}</td>
                          <td className={td}>{formatNumber(f.impressions)}</td>
                          <td className={td}>{formatNumber(f.clicks)}</td>
                          <td className={td}>{formatPercent(adMetrics.ctr(f), 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : null}
    </main>
  );
}

/**
 * The dashboard-facing wrapper — resolves the active workspace from the
 * "ws" cookie, renders the internal Topbar (with its cross-workspace
 * switcher), then the shared report body. Meta, Google and TikTok differ
 * only in provider key and label; never duplicated per channel.
 */
export async function AdsChannelPage({
  provider,
  label,
  searchParams,
}: {
  provider: DemoProvider;
  label: string;
  searchParams: ReportSearchParams;
}) {
  const workspaceId = await getActiveWorkspaceId();
  const workspaceName = await getWorkspaceName(workspaceId);
  const { range, preset } = resolveDateRange(await searchParams);
  return (
    <>
      <Topbar title={`${label} — ${workspaceName}`} />
      <AdsReport
        workspaceId={workspaceId}
        provider={provider}
        label={label}
        range={range}
        preset={preset}
      />
    </>
  );
}
