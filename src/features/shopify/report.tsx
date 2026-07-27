import { KpiCard } from "@/components/charts/kpi-card";
import { MoneyAreaChart, CountBarChart } from "@/components/charts/charts";
import { Card, CardHeader } from "@/components/ui/primitives";
import {
  getShopDaily,
  previousPeriod,
  formatRangeLabel,
  type DateRange,
  type RangePreset,
} from "@/features/metrics/queries";
import { getLiveShopifyReport } from "@/features/integrations/shopify-live";
import { getLiveShopifyProducts } from "@/features/integrations/shopify-products-live";
import type { ShopifyProductFacts } from "@/features/integrations/shopify";
import { shopMetrics, sumShopFacts, type ShopFacts } from "@/lib/metrics/definitions";
import { formatMoney, formatNumber, formatPercent } from "@/lib/utils";
import { isDemoMode } from "@/lib/env";

/**
 * The read-only Shopify report body — KPI grid + sales/customer charts —
 * with NO Topbar and NO workspace switcher. Takes workspaceId explicitly,
 * same split as OverviewReport/AdsReport, so it renders identically on the
 * internal dashboard route and the client portal's own Shopify page.
 */
export async function ShopifyReport({
  workspaceId,
  range,
  preset,
}: {
  workspaceId: string;
  range: DateRange;
  preset: RangePreset;
}) {
  const rangeLabel = formatRangeLabel(range, preset);
  const prevRange = previousPeriod(range);

  // Shopify is pulled live now (see features/integrations/shopify-live.ts)
  // — nothing syncs orders to the database anymore, same "pull-on-demand"
  // shape as Meta/Google Ads/TikTok. Demo mode keeps reading the
  // deterministic generator via getShopDaily since there's no real store
  // connected to pull from.
  let rows: Array<ShopFacts & { date: string }>;
  let prevRows: Array<ShopFacts & { date: string }>;
  let partialFailure = false;
  let failures: Array<{ displayName: string; reason: string }> = [];
  // Live-only, same as Meta/Google's deeper breakdowns — no demo-mode
  // equivalent exists for per-product data.
  let products: ShopifyProductFacts[] = [];

  if (!isDemoMode) {
    const [current, previous, productsResult] = await Promise.all([
      getLiveShopifyReport(workspaceId, range),
      getLiveShopifyReport(workspaceId, prevRange),
      getLiveShopifyProducts(workspaceId, range),
    ]);
    rows = current.rows;
    prevRows = previous.rows;
    products = productsResult.products;
    partialFailure = current.partialFailure || previous.partialFailure || productsResult.partialFailure;
    // Current-range failures are the most relevant to show — the previous-
    // period pull uses the same connections/credentials, so its failures
    // would just be duplicates for the same underlying reason. Product
    // failures use the same connections too, so de-dupe by display name.
    const seenFailures = new Set<string>();
    failures = [];
    for (const list of [current.failures, productsResult.failures]) {
      for (const f of list) {
        if (!seenFailures.has(f.displayName)) {
          seenFailures.add(f.displayName);
          failures.push(f);
        }
      }
    }
  } else {
    [rows, prevRows] = await Promise.all([
      getShopDaily(workspaceId, range),
      getShopDaily(workspaceId, prevRange),
    ]);
  }

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

  const th = "px-3 py-2 text-right font-medium whitespace-nowrap";
  const td = "px-3 py-2.5 text-right tabular-nums whitespace-nowrap";
  // Already sorted by sales server-side (fetchShopifyProductFacts) — just
  // cap the display, same top-50 pattern as the ads channels' entity
  // tables (Meta ad sets/ads, Google keywords/search terms).
  const PRODUCT_DISPLAY_CAP = 50;
  const productsShown = products.slice(0, PRODUCT_DISPLAY_CAP);

  return (
    <>
      {partialFailure ? (
        <div className="rounded-lg border border-negative/30 bg-negative/10 px-4 py-2.5 text-xs text-negative">
          <p>
            Couldn&apos;t reach {failures.length === 1 ? "one connected store" : `${failures.length || "one or more"} connected store(s)`} just
            now — numbers below may be incomplete. This report is pulled live on every page view,
            so refreshing may resolve it.
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

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted">
          {rangeLabel} · vs previous period · hover the ⓘ on any card for a plain-English explanation
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
          <CardHeader title="New customers" subtitle={`Daily, ${rangeLabel}`} />
          <div className="px-3 pb-4">
            <CountBarChart data={customerTrend} dataKey="new" label="New customers" />
          </div>
        </Card>
        <Card>
          <CardHeader title="Returning customers" subtitle={`Daily, ${rangeLabel}`} />
          <div className="px-3 pb-4">
            <CountBarChart data={customerTrend} dataKey="returning" label="Returning customers" />
          </div>
        </Card>
      </div>

      {!isDemoMode ? (
        <Card>
          <CardHeader
            title="Top products"
            subtitle={
              products.length > PRODUCT_DISPLAY_CAP
                ? `${rangeLabel} · showing top ${PRODUCT_DISPLAY_CAP} of ${products.length} by sales`
                : `${rangeLabel} · sorted by sales`
            }
          />
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className={th}>Sales</th>
                  <th className={th}>Units sold</th>
                  <th className={th}>Orders</th>
                  <th className={th}>Avg. price</th>
                </tr>
              </thead>
              <tbody>
                {productsShown.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted">
                      No product sales for this date range — connect a Shopify store in Settings, or try a wider
                      date range.
                    </td>
                  </tr>
                ) : null}
                {productsShown.map((p, i) => (
                  <tr
                    key={p.productId ?? `t:${p.title}:${i}`}
                    className="border-b border-border/60 last:border-0 hover:bg-surface-2/60"
                  >
                    <td className="max-w-[260px] truncate px-3 py-2.5 font-medium">{p.title}</td>
                    <td className="px-3 py-2.5 text-muted">{p.sku ?? "—"}</td>
                    <td className={td}>{formatMoney(p.revenueMinor)}</td>
                    <td className={td}>{formatNumber(p.quantity)}</td>
                    <td className={td}>{formatNumber(p.orders)}</td>
                    <td className={td}>{formatMoney(p.quantity > 0 ? Math.round(p.revenueMinor / p.quantity) : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}
