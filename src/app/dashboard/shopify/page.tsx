import { Topbar } from "@/components/shell/topbar";
import { KpiCard } from "@/components/charts/kpi-card";
import { MoneyAreaChart, CountBarChart } from "@/components/charts/charts";
import { Card, CardHeader } from "@/components/ui/primitives";
import { getShopDaily, lastNDays, previousPeriod } from "@/features/metrics/queries";
import { shopMetrics, sumShopFacts, type ShopFacts } from "@/lib/metrics/definitions";
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
  const metricDelta = (fn: (f: ShopFacts) => number, invert = false) => {
    const d = deltaOf(fn(totals), fn(prev));
    return invert ? -d : d;
  };

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

  /** The important store KPIs, one small card each, with plain-language info. vs previous 30 days. */
  const kpis: Array<{ label: string; value: string; delta?: number; hint?: string; info: string }> = [
    { label: "Gross sales", value: formatMoney(totals.grossSalesMinor), delta: deltaOf(totals.grossSalesMinor, prev.grossSalesMinor), info: "Total value of all orders placed, before refunds are subtracted." },
    { label: "Net sales", value: formatMoney(totals.netSalesMinor), delta: deltaOf(totals.netSalesMinor, prev.netSalesMinor), info: "Gross sales minus refunds — the actual revenue that stayed with the store." },
    { label: "Orders", value: formatNumber(totals.orders), delta: deltaOf(totals.orders, prev.orders), info: "Total number of orders placed on the store." },
    { label: "AOV", value: formatMoney(shopMetrics.aov(totals)), delta: metricDelta(shopMetrics.aov), info: "Average Order Value — the typical amount spent per order (net sales ÷ orders)." },
    { label: "Conversion rate", value: formatPercent(shopMetrics.conversionRate(totals), 2), delta: metricDelta(shopMetrics.conversionRate), info: "Of everyone who visited the store, what percentage actually placed an order." },
    { label: "Sessions", value: formatNumber(totals.sessions), delta: deltaOf(totals.sessions, prev.sessions), info: "Number of visits to the store, from all traffic sources." },
    { label: "Refunds", value: formatMoney(totals.refundsMinor), delta: -deltaOf(totals.refundsMinor, prev.refundsMinor), hint: "Lower is better", info: "Total value of orders that were refunded to customers." },
    { label: "Refund rate", value: formatPercent(shopMetrics.refundRate(totals)), delta: metricDelta(shopMetrics.refundRate, true), hint: "Of gross sales", info: "What share of gross sales came back as refunds. Lower means fewer returns/cancellations." },
    { label: "New customers", value: formatNumber(totals.newCustomers), delta: deltaOf(totals.newCustomers, prev.newCustomers), info: "Customers who bought from this store for the first time in this period." },
    { label: "Returning customers", value: formatNumber(totals.returningCustomers), delta: deltaOf(totals.returningCustomers, prev.returningCustomers), info: "Customers in this period who had already bought from this store before." },
    { label: "Returning share", value: formatPercent(shopMetrics.returningShare(totals)), delta: metricDelta(shopMetrics.returningShare), hint: "Of all customers", info: "What percentage of customers this period were repeat buyers — a sign of loyalty." },
    { label: "Revenue / session", value: formatMoney(totals.sessions > 0 ? totals.netSalesMinor / totals.sessions : 0), delta: deltaOf(totals.sessions > 0 ? totals.netSalesMinor / totals.sessions : 0, prev.sessions > 0 ? prev.netSalesMinor / prev.sessions : 0), info: "On average, how much revenue each store visit generated — combines traffic quality and conversion into one number." },
  ];

  const workspaceName = await getWorkspaceName(workspaceId);

  return (
    <>
      <Topbar title={`Shopify — ${workspaceName}`} />
      <main className="space-y-6 px-6 py-6">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted">
            Last 30 days · vs previous 30 days · hover the ⓘ on any card for a plain-English explanation
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
            {kpis.map((k) => (
              <KpiCard key={k.label} label={k.label} value={k.value} delta={k.delta} hint={k.hint} info={k.info} />
            ))}
          </div>
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
          <Card>
            <CardHeader title="Returning customers" subtitle="Daily, last 30 days" />
            <div className="px-3 pb-4">
              <CountBarChart data={customerTrend} dataKey="returning" label="Returning customers" />
            </div>
          </Card>
        </div>
      </main>
    </>
  );
}
