import { Topbar } from "@/components/shell/topbar";
import { KpiCard } from "@/components/charts/kpi-card";
import { MoneyAreaChart, CountBarChart } from "@/components/charts/charts";
import { Card, CardHeader, Badge } from "@/components/ui/primitives";
import {
  getAdDaily,
  getShopDaily,
  lastNDays,
  previousPeriod,
} from "@/features/metrics/queries";
import {
  adMetrics,
  blendedMetrics,
  shopMetrics,
  sumAdFacts,
  sumShopFacts,
} from "@/lib/metrics/definitions";
import { formatMoney, formatNumber, formatPercent } from "@/lib/utils";
import { getActiveWorkspaceId, getWorkspaceName } from "@/lib/workspace";

/** Agency overview: blended shop + ads performance for the active client. */
export default async function OverviewPage() {
  const workspaceId = await getActiveWorkspaceId();
  const range = lastNDays(30);
  const prevRange = previousPeriod(range);

  const [ads, shop, prevAds, prevShop] = await Promise.all([
    getAdDaily(workspaceId, range),
    getShopDaily(workspaceId, range),
    getAdDaily(workspaceId, prevRange),
    getShopDaily(workspaceId, prevRange),
  ]);

  const adTotals = sumAdFacts(ads);
  const shopTotals = sumShopFacts(shop);
  const prevAdTotals = sumAdFacts(prevAds);
  const prevShopTotals = sumShopFacts(prevShop);

  const deltaOf = (curr: number, prev: number) =>
    prev > 0 ? (curr - prev) / prev : 0;

  // Merge ads spend + shop revenue into one daily trend.
  const byDate = new Map<string, { date: string; revenue: number; spend: number }>();
  for (const s of shop) {
    byDate.set(s.date, { date: s.date, revenue: s.netSalesMinor, spend: 0 });
  }
  for (const a of ads) {
    const row = byDate.get(a.date) ?? { date: a.date, revenue: 0, spend: 0 };
    row.spend += a.spendMinor;
    byDate.set(a.date, row);
  }
  const trend = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const ordersTrend = shop.map((s) => ({ date: s.date, orders: s.orders }));

  return (
    <>
      <Topbar title={`Overview — ${getWorkspaceName(workspaceId)}`} />
      <main className="space-y-6 px-6 py-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Net revenue (30d)"
            value={formatMoney(shopTotals.netSalesMinor)}
            delta={deltaOf(shopTotals.netSalesMinor, prevShopTotals.netSalesMinor)}
          />
          <KpiCard
            label="Ad spend (30d)"
            value={formatMoney(adTotals.spendMinor)}
            delta={deltaOf(adTotals.spendMinor, prevAdTotals.spendMinor)}
          />
          <KpiCard
            label="Blended MER"
            value={`${blendedMetrics.mer(shopTotals, adTotals).toFixed(2)}x`}
            delta={deltaOf(
              blendedMetrics.mer(shopTotals, adTotals),
              blendedMetrics.mer(prevShopTotals, prevAdTotals),
            )}
            hint="Net revenue ÷ total ad spend"
          />
          <KpiCard
            label="Net after ad spend"
            value={formatMoney(
              blendedMetrics.netAfterAdSpendMinor(shopTotals, adTotals),
            )}
            delta={deltaOf(
              blendedMetrics.netAfterAdSpendMinor(shopTotals, adTotals),
              blendedMetrics.netAfterAdSpendMinor(prevShopTotals, prevAdTotals),
            )}
            hint="Before COGS & shipping"
          />
        </div>

        <Card>
          <CardHeader
            title="Revenue vs ad spend"
            subtitle="Daily, last 30 days"
            action={<Badge tone="outline">All channels</Badge>}
          />
          <div className="px-3 pb-4">
            <MoneyAreaChart
              data={trend}
              series={[
                { key: "revenue", label: "Net revenue" },
                { key: "spend", label: "Ad spend" },
              ]}
            />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Orders" subtitle="Daily, last 30 days" />
            <div className="px-3 pb-4">
              <CountBarChart data={ordersTrend} dataKey="orders" label="Orders" />
            </div>
          </Card>
          <Card>
            <CardHeader title="Channel efficiency" subtitle="Last 30 days" />
            <div className="space-y-3 px-5 pb-5 pt-2">
              {(["meta", "google_ads", "tiktok"] as const).map((provider) => {
                const rows = ads.filter((a) => a.provider === provider);
                const totals = sumAdFacts(rows);
                const roas = adMetrics.roas(totals);
                return (
                  <div
                    key={provider}
                    className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                  >
                    <div>
                      <p className="text-[13px] font-medium capitalize">
                        {provider.replace("_", " ")}
                      </p>
                      <p className="text-xs text-muted">
                        {formatMoney(totals.spendMinor)} spend ·{" "}
                        {formatNumber(totals.purchases)} purchases
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {roas.toFixed(2)}x
                      </p>
                      <p className="text-[11px] text-muted">
                        CTR {formatPercent(adMetrics.ctr(totals))}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Orders"
            value={formatNumber(shopTotals.orders)}
            delta={deltaOf(shopTotals.orders, prevShopTotals.orders)}
          />
          <KpiCard
            label="AOV"
            value={formatMoney(shopMetrics.aov(shopTotals))}
            delta={deltaOf(
              shopMetrics.aov(shopTotals),
              shopMetrics.aov(prevShopTotals),
            )}
          />
          <KpiCard
            label="Conversion rate"
            value={formatPercent(shopMetrics.conversionRate(shopTotals), 2)}
            delta={deltaOf(
              shopMetrics.conversionRate(shopTotals),
              shopMetrics.conversionRate(prevShopTotals),
            )}
          />
          <KpiCard
            label="Returning customers"
            value={formatPercent(shopMetrics.returningShare(shopTotals))}
            hint="Share of 30d orders"
          />
        </div>
      </main>
    </>
  );
}
