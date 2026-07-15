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
 * One shared, reusable channel page for every ads provider — Meta, Google
 * and TikTok differ only in provider key and label. Never duplicated per
 * channel. Full KPI grid + campaign-level table, all computed from the
 * single metric-definition module. Every KPI carries a plain-language
 * explanation (hover the ⓘ) so non-marketers can read the dashboard.
 */
export async function AdsChannelPage({
  provider,
  label,
}: {
  provider: DemoProvider;
  label: string;
}) {
  const workspaceId = await getActiveWorkspaceId();
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
  const kpis: Array<{ label: string; value: string; delta?: number; hint?: string; info: string }> = [
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
    { label: "Hook rate", value: formatPercent(adMetrics.hookRate(totals)), delta: metricDelta(adMetrics.hookRate), hint: "3s video views ÷ impressions", info: "Of everyone who saw the video ad, what share watched at least 3 seconds — a sign the opening is grabbing attention." },
    { label: "Video views (3s)", value: formatNumber(totals.videoViews3s), delta: deltaOf(totals.videoViews3s, prev.videoViews3s), info: "Number of times the video was watched for at least 3 seconds." },
  ];

  const th = "px-3 py-2 text-right font-medium whitespace-nowrap";
  const td = "px-3 py-2.5 text-right tabular-nums whitespace-nowrap";
  const workspaceName = await getWorkspaceName(workspaceId);

  return (
    <>
      <Topbar title={`${label} — ${workspaceName}`} />
      <main className="space-y-6 px-6 py-6">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted">
            Last 30 days · vs previous 30 days · hover the ⓘ on any card for a plain-English explanation
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
            {kpis.map((k) => (
              <KpiCard key={k.label} label={k.label} value={k.value} delta={k.delta} hint={k.hint} info={k.info} />
            ))}
          </div>
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
    </>
  );
}
