import { Topbar } from "@/components/shell/topbar";
import { KpiCard } from "@/components/charts/kpi-card";
import { MoneyAreaChart, CountBarChart } from "@/components/charts/charts";
import { Card, CardHeader } from "@/components/ui/primitives";
import { getShopDaily, lastNDays, previousPeriod } from "@/features/metrics/queries";
import { shopMetrics, sumShopFacts } from "@/lib/metrics/definitions";
import { formatMoney, formatNumber, formatPercent } from "@/lib/utils";
import { getActiveWorkspaceId, getWorkspaceName } from "@/lib/workspace";

export const metadata = { title: "Shopify" };

export default async function ShopifyPage() {
  const workspaceId = await getActiveWorkspaceId();
  const range = lastNDays(30);
  const [rows, prevRows] = await Promise.all([
    getShopDaily(workspaceId, range),
    getShopDaily(workspaceId, previousPeriod(range)),
  ]);
  const totals = sumShopFacts(rows);
  const prev = sumShopFacts(prevRows);
  const deltaOf = (c: number, p: number) => (p > 0 ? (c - p) / p : 0);

  const salesTrend = rows.map((r) => ({
    date: r.date,
    gross: r.grossSalesMinor,
    net: r.netSalesMinor,
  }));
  const customerTrend = rows.map((r) => ({
    date: r.date,
    new: r.newCustomers,
    returning: r.returningCustomers,
  }));

  return (
    <>
      <Topbar title={`Shopify — ${getWorkspaceName(workspaceId)}`} />
      <main className="space-y-6 px-6 py-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Gross sales (30d)"
            value={formatMoney(totals.grossSalesMinor)}
            delta={deltaOf(totals.grossSalesMinor, prev.grossSalesMinor)}
          />
          <KpiCard
            label="Net sales (30d)"
            value={formatMoney(totals.netSalesMinor)}
            delta={deltaOf(totals.netSalesMinor, prev.netSalesMinor)}
          />
          <KpiCard
            label="Orders"
            value={formatNumber(totals.orders)}
            delta={deltaOf(totals.orders, prev.orders)}
          />
          <KpiCard
            label="Refunds"
            value={formatMoney(totals.refundsMinor)}
            delta={-deltaOf(totals.refundsMinor, prev.refundsMinor)}
            hint={`${formatPercent(shopMetrics.refundRate(totals))} of gross`}
          />
        </div>

        <Card>
          <CardHeader title="Sales" subtitle="Gross vs net, daily" />
          <div className="px-3 pb-4">
            <MoneyAreaChart
              data={salesTrend}
              series={[
                { key: "net", label: "Net sales" },
                { key: "gross", label: "Gross sales" },
              ]}
            />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="New customers" subtitle="Daily, last 30 days" />
            <div className="px-3 pb-4">
              <CountBarChart data={customerTrend} dataKey="new" label="New customers" />
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <KpiCard
              label="AOV"
              value={formatMoney(shopMetrics.aov(totals))}
              delta={deltaOf(shopMetrics.aov(totals), shopMetrics.aov(prev))}
            />
            <KpiCard
              label="Conversion rate"
              value={formatPercent(shopMetrics.conversionRate(totals), 2)}
              delta={deltaOf(
                shopMetrics.conversionRate(totals),
                shopMetrics.conversionRate(prev),
              )}
            />
            <KpiCard
              label="Sessions"
              value={formatNumber(totals.sessions)}
              delta={deltaOf(totals.sessions, prev.sessions)}
            />
            <KpiCard
              label="Returning share"
              value={formatPercent(shopMetrics.returningShare(totals))}
              delta={deltaOf(
                shopMetrics.returningShare(totals),
                shopMetrics.returningShare(prev),
              )}
            />
          </div>
        </div>
      </main>
    </>
  );
}
