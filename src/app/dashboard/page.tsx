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

interface Kpi {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
  info?: string;
}

/** Agency overview: full blended + ads + store KPI set for the active client. */
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

  const a = sumAdFacts(ads);
  const s = sumShopFacts(shop);
  const pa = sumAdFacts(prevAds);
  const ps = sumShopFacts(prevShop);

  const deltaOf = (curr: number, prev: number) =>
    prev > 0 ? (curr - prev) / prev : 0;

  const mer = blendedMetrics.mer(s, a);
  const netAfterAds = blendedMetrics.netAfterAdSpendMinor(s, a);
  const isProfitable = netAfterAds >= 0;

  const blendedKpis: Kpi[] = [
    { label: "Net revenue", value: formatMoney(s.netSalesMinor), delta: deltaOf(s.netSalesMinor, ps.netSalesMinor), info: "Total money from orders, after refunds — your actual store revenue for the period." },
    { label: "Total ad spend", value: formatMoney(a.spendMinor), delta: deltaOf(a.spendMinor, pa.spendMinor), info: "How much you paid Meta, Google and TikTok combined to run ads." },
    { label: "Blended MER", value: `${mer.toFixed(2)}x`, delta: deltaOf(mer, blendedMetrics.mer(ps, pa)), hint: "Net revenue ÷ ad spend", info: "For every ₹1 spent on ads (across all platforms), how many ₹ came back in store revenue. Above 1x means ads are paying for themselves." },
    { label: "Net after ad spend", value: formatMoney(netAfterAds), delta: deltaOf(netAfterAds, blendedMetrics.netAfterAdSpendMinor(ps, pa)), hint: "Before COGS & shipping", info: "Revenue left over once you subtract ad spend — not your final profit yet (product cost and shipping aren't subtracted here), but a quick health check." },
  ];

  const adsKpis: Kpi[] = [
    { label: "Attributed revenue", value: formatMoney(a.revenueMinor), delta: deltaOf(a.revenueMinor, pa.revenueMinor), info: "Revenue the ad platforms report as coming from their own ads (their own tracking, not your store's total revenue)." },
    { label: "Blended ROAS", value: `${adMetrics.roas(a).toFixed(2)}x`, delta: deltaOf(adMetrics.roas(a), adMetrics.roas(pa)), info: "Return On Ad Spend — revenue the ads generated per ₹1 spent, according to the ad platforms themselves. Higher is better." },
    { label: "Purchases (ads)", value: formatNumber(a.purchases), delta: deltaOf(a.purchases, pa.purchases), info: "Number of purchases the ad platforms say their ads led to." },
    { label: "CPA", value: formatMoney(adMetrics.cpa(a)), delta: -deltaOf(adMetrics.cpa(a), adMetrics.cpa(pa)), hint: "Lower is better", info: "Cost Per Acquisition — how much you paid in ads, on average, to get one purchase." },
    { label: "CTR", value: formatPercent(adMetrics.ctr(a), 2), delta: deltaOf(adMetrics.ctr(a), adMetrics.ctr(pa)), info: "Click-Through Rate — the share of people who saw your ad and clicked it. Higher usually means your ad is more appealing." },
    { label: "CPM", value: formatMoney(adMetrics.cpm(a)), delta: -deltaOf(adMetrics.cpm(a), adMetrics.cpm(pa)), hint: "Lower is better", info: "Cost per 1,000 impressions — what you pay just to show your ad to 1,000 people, before any clicks or sales." },
    { label: "Impressions", value: formatNumber(a.impressions), delta: deltaOf(a.impressions, pa.impressions), info: "Total number of times your ads were shown on screen." },
    { label: "Clicks", value: formatNumber(a.clicks), delta: deltaOf(a.clicks, pa.clicks), info: "Total number of times people clicked on your ads." },
  ];

  const shopKpis: Kpi[] = [
    { label: "Orders", value: formatNumber(s.orders), delta: deltaOf(s.orders, ps.orders), info: "Number of orders placed on your store." },
    { label: "AOV", value: formatMoney(shopMetrics.aov(s)), delta: deltaOf(shopMetrics.aov(s), shopMetrics.aov(ps)), info: "Average Order Value — the typical amount a customer spends per order." },
    { label: "Conversion rate", value: formatPercent(shopMetrics.conversionRate(s), 2), delta: deltaOf(shopMetrics.conversionRate(s), shopMetrics.conversionRate(ps)), info: "Of everyone who visited your store, what percentage actually placed an order." },
    { label: "Sessions", value: formatNumber(s.sessions), delta: deltaOf(s.sessions, ps.sessions), info: "Number of visits to your store." },
    { label: "Gross sales", value: formatMoney(s.grossSalesMinor), delta: deltaOf(s.grossSalesMinor, ps.grossSalesMinor), info: "Total sales before refunds are subtracted." },
    { label: "Refund rate", value: formatPercent(shopMetrics.refundRate(s)), delta: -deltaOf(shopMetrics.refundRate(s), shopMetrics.refundRate(ps)), hint: "Lower is better", info: "What share of your gross sales came back as refunds." },
    { label: "New customers", value: formatNumber(s.newCustomers), delta: deltaOf(s.newCustomers, ps.newCustomers), info: "Customers who bought from you for the first time in this period." },
    { label: "Returning share", value: formatPercent(shopMetrics.returningShare(s)), delta: deltaOf(shopMetrics.returningShare(s), shopMetrics.returningShare(ps)), info: "What percentage of your customers this period had bought from you before — a sign of loyalty." },
  ];

  // Merge ads spend + shop revenue into one daily trend.
  const byDate = new Map<string, { date: string; revenue: number; spend: number }>();
  for (const row of shop) {
    byDate.set(row.date, { date: row.date, revenue: row.netSalesMinor, spend: 0 });
  }
  for (const row of ads) {
    const entry = byDate.get(row.date) ?? { date: row.date, revenue: 0, spend: 0 };
    entry.spend += row.spendMinor;
    byDate.set(row.date, entry);
  }
  const trend = [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date));
  const ordersTrend = shop.map((r) => ({ date: r.date, orders: r.orders }));

  const grid = "grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8";

  return (
    <>
      <Topbar title={`Overview — ${getWorkspaceName(workspaceId)}`} />
      <main className="space-y-6 px-6 py-6">
        <Card
          className={
            isProfitable
              ? "border-positive/30 bg-positive/5 px-5 py-4"
              : "border-negative/30 bg-negative/5 px-5 py-4"
          }
        >
          <p className="text-[13px] leading-relaxed">
            In the last 30 days, <span className="font-semibold">{getWorkspaceName(workspaceId)}</span>{" "}
            made <span className="font-semibold">{formatMoney(s.netSalesMinor)}</span> in
            revenue from <span className="font-semibold">{s.orders}</span> orders,
            and spent <span className="font-semibold">{formatMoney(a.spendMinor)}</span> on
            ads. That means for every ₹1 spent on ads,{" "}
            <span className="font-semibold">₹{mer.toFixed(2)}</span> came back in
            revenue —{" "}
            <span className={isProfitable ? "text-positive font-medium" : "text-negative font-medium"}>
              {isProfitable ? "ads are paying for themselves." : "ads are currently costing more than they bring in."}
            </span>
          </p>
        </Card>

        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted">
            Blended · last 30 days vs previous 30
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {blendedKpis.map((k) => (
              <KpiCard key={k.label} {...k} />
            ))}
          </div>
        </section>

        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted">
            Paid ads · all channels combined
          </p>
          <div className={grid}>
            {adsKpis.map((k) => (
              <KpiCard key={k.label} {...k} />
            ))}
          </div>
        </section>

        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted">
            Store
          </p>
          <div className={grid}>
            {shopKpis.map((k) => (
              <KpiCard key={k.label} {...k} />
            ))}
          </div>
        </section>

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
                const rows = ads.filter((r) => r.provider === provider);
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
                        {formatNumber(totals.purchases)} purchases · CPA{" "}
                        {formatMoney(adMetrics.cpa(totals))}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {roas.toFixed(2)}x
                      </p>
                      <p className="text-[11px] text-muted">
                        CTR {formatPercent(adMetrics.ctr(totals))} · CPM{" "}
                        {formatMoney(adMetrics.cpm(totals))}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </main>
    </>
  );
}
