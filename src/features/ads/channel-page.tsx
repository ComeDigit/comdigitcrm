import { Topbar } from "@/components/shell/topbar";
import { KpiCard } from "@/components/charts/kpi-card";
import { MoneyAreaChart } from "@/components/charts/charts";
import { Card, CardHeader, Badge } from "@/components/ui/primitives";
import { getAdDaily, lastNDays, previousPeriod } from "@/features/metrics/queries";
import { adMetrics, sumAdFacts } from "@/lib/metrics/definitions";
import { demoCampaigns, type DemoProvider } from "@/features/demo-data/generator";
import { formatMoney, formatNumber, formatPercent } from "@/lib/utils";
import { getActiveWorkspaceId, getWorkspaceName } from "@/lib/workspace";

/**
 * One shared, reusable channel page for every ads provider — Meta, Google
 * and TikTok differ only in provider key and label. Never duplicated per
 * channel.
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

  const trend = rows
    .map((r) => ({ date: r.date, spend: r.spendMinor, revenue: r.revenueMinor }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const campaigns = demoCampaigns(workspaceId, provider).sort(
    (a, b) => b.facts.spendMinor - a.facts.spendMinor,
  );

  return (
    <>
      <Topbar title={`${label} — ${getWorkspaceName(workspaceId)}`} />
      <main className="space-y-6 px-6 py-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Spend (30d)"
            value={formatMoney(totals.spendMinor)}
            delta={deltaOf(totals.spendMinor, prev.spendMinor)}
          />
          <KpiCard
            label="ROAS"
            value={`${adMetrics.roas(totals).toFixed(2)}x`}
            delta={deltaOf(adMetrics.roas(totals), adMetrics.roas(prev))}
          />
          <KpiCard
            label="CPA"
            value={formatMoney(adMetrics.cpa(totals))}
            delta={-deltaOf(adMetrics.cpa(totals), adMetrics.cpa(prev))}
            hint="Lower is better"
          />
          <KpiCard
            label="CTR"
            value={formatPercent(adMetrics.ctr(totals), 2)}
            delta={deltaOf(adMetrics.ctr(totals), adMetrics.ctr(prev))}
          />
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
            subtitle="Last 30 days · sorted by spend"
          />
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Campaign</th>
                  <th className="px-3 py-2 text-right font-medium">Spend</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">ROAS</th>
                  <th className="px-3 py-2 text-right font-medium">CTR</th>
                  <th className="px-3 py-2 text-right font-medium">CPA</th>
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const roas = adMetrics.roas(c.facts);
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-border/60 last:border-0 hover:bg-surface-2/60"
                    >
                      <td className="max-w-[280px] truncate px-3 py-2.5 font-medium">
                        {c.name}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatMoney(c.facts.spendMinor)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatMoney(c.facts.revenueMinor)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <span className={roas >= 2 ? "text-positive" : "text-negative"}>
                          {roas.toFixed(2)}x
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatPercent(adMetrics.ctr(c.facts), 2)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatMoney(adMetrics.cpa(c.facts))}
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

        <p className="text-xs text-muted">
          Impressions {formatNumber(totals.impressions)} · Reach{" "}
          {formatNumber(totals.reach)} · Frequency{" "}
          {adMetrics.frequency(totals).toFixed(2)} · Hook rate{" "}
          {formatPercent(adMetrics.hookRate(totals))}
        </p>
      </main>
    </>
  );
}
