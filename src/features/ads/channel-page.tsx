import { Topbar } from "@/components/shell/topbar";
import { KpiCard } from "@/components/charts/kpi-card";
import { MoneyAreaChart } from "@/components/charts/charts";
import { Card, CardHeader, Badge } from "@/components/ui/primitives";
import { getAdDaily, lastNDays, previousPeriod } from "@/features/metrics/queries";
import { adMetrics, sumAdFacts, type AdFacts } from "@/lib/metrics/definitions";
import { demoCampaigns, type DemoProvider } from "@/features/demo-data/generator";
import { formatMoney, formatNumber, formatPercent } from "@/lib/utils";
import { getActiveWorkspaceId, getWorkspaceName } from "@/lib/workspace";

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
}: {
  workspaceId: string;
  provider: DemoProvider;
  label: string;
}) {
  const range = lastNDays(30);
  const [rows, prevRows] = await Promise.all([
    getAdDaily(workspaceId, range, [provider]),
    getAdDaily(workspaceId, previousPeriod(range), [provider]),
  ]);
  const totals = sumAdFacts(rows);
  const prev = sumAdFacts(prevRows);
  const deltaOf = (curr: number, p: number) => (p > 0 ? (curr - p) / p : 0);
  const metricDelta = (fn: (f: AdFacts) => number, invert = false) => {
    const d = deltaOf(fn(totals), fn(prev));
    return invert ? -d : d;
  };

  const trend = rows
    .map((r) => ({ date: r.date, spend: r.spendMinor, revenue: r.revenueMinor }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const campaigns = demoCampaigns(workspaceId, provider).sort(
    (a, b) => b.facts.spendMinor - a.facts.spendMinor,
  );

  /** The important KPI set, one small card each, with plain-language info. vs previous 30 days. */
  type Kpi = { label: string; value: string; delta?: number; hint?: string; info: string };
  const overviewKpis: Kpi[] = [
    { label: "Spend", value: formatMoney(totals.spendMinor), delta: deltaOf(totals.spendMinor, prev.spendMinor), info: `Total money paid to ${label} to run ads this period.` },
    { label: "Revenue", value: formatMoney(totals.revenueMinor), delta: deltaOf(totals.revenueMinor, prev.revenueMinor), info: `Revenue ${label} reports as coming from its own ads (its own tracking).` },
    { label: "ROAS", value: `${adMetrics.roas(totals).toFixed(2)}x`, delta: metricDelta(adMetrics.roas), info: "Return On Ad Spend — revenue earned per ₹1 spent. Above 1x means the ads paid for themselves; higher is better." },
    { label: "Purchases", value: formatNumber(totals.purchases), delta: deltaOf(totals.purchases, prev.purchases), info: "Number of purchases attributed to these ads." },
    { label: "CPA", value: formatMoney(adMetrics.cpa(totals)), delta: metricDelta(adMetrics.cpa, true), hint: "Lower is better", info: "Cost Per Acquisition — average ad spend needed to get one purchase." },
    { label: "CPC", value: formatMoney(adMetrics.cpc(totals)), delta: metricDelta(adMetrics.cpc, true), hint: "Lower is better", info: "Cost Per Click — average amount paid each time someone clicks the ad." },
    { label: "CPM", value: formatMoney(adMetrics.cpm(totals)), delta: metricDelta(adMetrics.cpm, true), hint: "Lower is better", info: "Cost per 1,000 impressions — what it costs just to show the ad to 1,000 people." },
    { label: "CTR", value: formatPercent(adMetrics.ctr(totals), 2), delta: metricDelta(adMetrics.ctr), info: "Click-Through Rate — percentage of people who saw the ad and clicked it." },
    { label: "Impressions", value: formatNumber(totals.impressions), delta: deltaOf(totals.impressions, prev.impressions), info: "Total number of times the ad was shown on screen." },
    { label: "Clicks", value: formatNumber(totals.clicks), delta: deltaOf(totals.clicks, prev.clicks), info: "Total number of clicks the ad received." },
    { label: "Reach", value: formatNumber(totals.reach), delta: deltaOf(totals.reach, prev.reach), info: "Number of unique people who saw the ad at least once (not counting repeats)." },
    { label: "Frequency", value: adMetrics.frequency(totals).toFixed(2), delta: metricDelta(adMetrics.frequency), hint: "Impressions ÷ reach", info: "Average number of times each person saw the ad. If this climbs too high, people may get tired of seeing it (ad fatigue)." },
  ];

  const clicksKpis: Kpi[] = [
    { label: "Inline link clicks", value: formatNumber(totals.inlineLinkClicks), delta: deltaOf(totals.inlineLinkClicks, prev.inlineLinkClicks), info: "Clicks on links inside the ad itself — excludes reactions, shares, and other engagement." },
    { label: "Outbound clicks", value: formatNumber(totals.outboundClicks), delta: deltaOf(totals.outboundClicks, prev.outboundClicks), info: "Clicks that sent someone away from the platform to the advertiser's website." },
    { label: "Outbound CTR", value: formatPercent(adMetrics.outboundCtr(totals), 2), delta: metricDelta(adMetrics.outboundCtr), info: "Share of impressions that resulted in an outbound click to the website." },
    { label: "Cost / outbound click", value: formatMoney(adMetrics.costPerOutboundClick(totals)), delta: metricDelta(adMetrics.costPerOutboundClick, true), hint: "Lower is better", info: "Average ad spend needed to send one person to the website." },
    { label: "Unique clicks", value: formatNumber(totals.uniqueClicks), delta: deltaOf(totals.uniqueClicks, prev.uniqueClicks), info: "Number of distinct people who clicked — unlike Clicks, this doesn't count the same person twice." },
    { label: "Landing page views", value: formatNumber(totals.landingPageViews), delta: deltaOf(totals.landingPageViews, prev.landingPageViews), info: "Number of times the linked page actually finished loading after a click." },
    { label: "Cost / landing page view", value: formatMoney(adMetrics.costPerLandingPageView(totals)), delta: metricDelta(adMetrics.costPerLandingPageView, true), hint: "Lower is better", info: "Average ad spend needed for one person to land on a fully-loaded page." },
    { label: "Page engagements", value: formatNumber(totals.pageEngagements), delta: deltaOf(totals.pageEngagements, prev.pageEngagements), info: "Likes, comments, shares, and other reactions to the ad's page or post, combined." },
  ];

  const videoKpis: Kpi[] = [
    { label: "Video views (3s)", value: formatNumber(totals.videoViews3s), delta: deltaOf(totals.videoViews3s, prev.videoViews3s), info: "Number of times the video was watched for at least 3 seconds." },
    { label: "Hook rate", value: formatPercent(adMetrics.hookRate(totals)), delta: metricDelta(adMetrics.hookRate), hint: "3s video views ÷ impressions", info: "Of everyone who saw the video ad, what share watched at least 3 seconds — a sign the opening is grabbing attention." },
    { label: "Thruplays", value: formatNumber(totals.videoThruplays), delta: deltaOf(totals.videoThruplays, prev.videoThruplays), info: "Number of times the video played to completion, or for at least 15 seconds if longer." },
    { label: "Cost / thruplay", value: formatMoney(adMetrics.costPerThruplay(totals)), delta: metricDelta(adMetrics.costPerThruplay, true), hint: "Lower is better", info: "Average ad spend needed for one full (or 15s+) video view." },
    { label: "Watched 50%", value: formatNumber(totals.videoP50), delta: deltaOf(totals.videoP50, prev.videoP50), info: "Number of views that reached the halfway point of the video." },
    { label: "Watched 75%", value: formatNumber(totals.videoP75), delta: deltaOf(totals.videoP75, prev.videoP75), info: "Number of views that reached three-quarters of the video." },
    { label: "Watched 100%", value: formatNumber(totals.videoP100), delta: deltaOf(totals.videoP100, prev.videoP100), info: "Number of views that watched the video all the way to the end." },
  ];

  const funnelKpis: Kpi[] = [
    { label: "View content", value: formatNumber(totals.viewContent), delta: deltaOf(totals.viewContent, prev.viewContent), info: "Number of times someone viewed a product or content page after clicking the ad." },
    { label: "Cost / view content", value: formatMoney(adMetrics.costPerViewContent(totals)), delta: metricDelta(adMetrics.costPerViewContent, true), hint: "Lower is better", info: "Average ad spend needed for one product-page view." },
    { label: "Add to cart", value: formatNumber(totals.addToCart), delta: deltaOf(totals.addToCart, prev.addToCart), info: "Number of times someone added a product to their cart." },
    { label: "Cost / add to cart", value: formatMoney(adMetrics.costPerAddToCart(totals)), delta: metricDelta(adMetrics.costPerAddToCart, true), hint: "Lower is better", info: "Average ad spend needed for one add-to-cart." },
    { label: "Initiate checkout", value: formatNumber(totals.initiateCheckout), delta: deltaOf(totals.initiateCheckout, prev.initiateCheckout), info: "Number of times someone started the checkout process." },
    { label: "Cost / checkout started", value: formatMoney(adMetrics.costPerInitiateCheckout(totals)), delta: metricDelta(adMetrics.costPerInitiateCheckout, true), hint: "Lower is better", info: "Average ad spend needed for one checkout to be started." },
    { label: "Add payment info", value: formatNumber(totals.addPaymentInfo), delta: deltaOf(totals.addPaymentInfo, prev.addPaymentInfo), info: "Number of times someone entered payment details during checkout." },
    { label: "Cost / payment info", value: formatMoney(adMetrics.costPerAddPaymentInfo(totals)), delta: metricDelta(adMetrics.costPerAddPaymentInfo, true), hint: "Lower is better", info: "Average ad spend needed for one payment-info entry." },
    { label: "Leads", value: formatNumber(totals.leads), delta: deltaOf(totals.leads, prev.leads), info: "Number of leads (form fills, sign-ups, etc.) attributed to these ads." },
    { label: "Cost / lead", value: formatMoney(adMetrics.costPerLead(totals)), delta: metricDelta(adMetrics.costPerLead, true), hint: "Lower is better", info: "Average ad spend needed for one lead." },
    { label: "Cost / purchase", value: formatMoney(adMetrics.costPerPurchase(totals)), delta: metricDelta(adMetrics.costPerPurchase, true), hint: "Lower is better", info: "Same as CPA — average ad spend needed for one purchase, shown alongside the rest of the funnel." },
  ];

  const kpiGroups: Array<{ title: string; subtitle: string; items: Kpi[] }> = [
    { title: "Overview", subtitle: "Last 30 days · vs previous 30 days", items: overviewKpis },
    { title: "Clicks & landing", subtitle: "Off-platform engagement", items: clicksKpis },
    { title: "Video", subtitle: "Watch-through funnel", items: videoKpis },
    { title: "Conversion funnel", subtitle: "Product → purchase, each step with its own cost", items: funnelKpis },
  ];

  const th = "px-3 py-2 text-right font-medium whitespace-nowrap";
  const td = "px-3 py-2.5 text-right tabular-nums whitespace-nowrap";

  /** Meta's three campaign-grain quality signals — coloured so a below-average
   * ranking is easy to spot without reading the label. */
  const rankTone = (rank?: string): "positive" | "neutral" | "negative" | "outline" => {
    if (rank === "above_average") return "positive";
    if (rank === "below_average") return "negative";
    if (rank === "average") return "neutral";
    return "outline";
  };
  const rankLabel = (rank?: string) => (rank ? rank.replace(/_/g, " ") : "—");

  return (
    <main className="space-y-6 px-6 py-6">
        <div className="space-y-5">
          <p className="text-xs font-medium uppercase tracking-widest text-muted">
            Last 30 days · vs previous 30 days · hover the ⓘ on any card for a plain-English explanation
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
          <CardHeader title="Spend vs attributed revenue" subtitle="Daily, last 30 days" />
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
            subtitle="Last 30 days · all key KPIs per campaign · sorted by spend"
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
}: {
  provider: DemoProvider;
  label: string;
}) {
  const workspaceId = await getActiveWorkspaceId();
  const workspaceName = await getWorkspaceName(workspaceId);
  return (
    <>
      <Topbar title={`${label} — ${workspaceName}`} />
      <AdsReport workspaceId={workspaceId} provider={provider} label={label} />
    </>
  );
}
