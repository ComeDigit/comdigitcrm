/**
 * THE single place derived marketing metrics are defined.
 * Ratios are never stored in the database — always computed from base
 * facts here, so every dashboard, report, and AI answer agrees.
 */

export interface AdFacts {
  spendMinor: number;
  revenueMinor: number;
  impressions: number;
  clicks: number;
  purchases: number;
  reach: number;
  videoViews3s: number;
  videoPlays: number;
}

export interface ShopFacts {
  grossSalesMinor: number;
  netSalesMinor: number;
  refundsMinor: number;
  orders: number;
  sessions: number;
  newCustomers: number;
  returningCustomers: number;
}

const ratio = (num: number, den: number): number => (den > 0 ? num / den : 0);

export const adMetrics = {
  roas: (f: AdFacts) => ratio(f.revenueMinor, f.spendMinor),
  ctr: (f: AdFacts) => ratio(f.clicks, f.impressions),
  cpc: (f: AdFacts) => ratio(f.spendMinor, f.clicks),
  cpm: (f: AdFacts) => ratio(f.spendMinor, f.impressions) * 1000,
  cpa: (f: AdFacts) => ratio(f.spendMinor, f.purchases),
  frequency: (f: AdFacts) => ratio(f.impressions, f.reach),
  hookRate: (f: AdFacts) => ratio(f.videoViews3s, f.impressions),
} as const;

export const shopMetrics = {
  aov: (f: ShopFacts) => ratio(f.netSalesMinor, f.orders),
  conversionRate: (f: ShopFacts) => ratio(f.orders, f.sessions),
  refundRate: (f: ShopFacts) => ratio(f.refundsMinor, f.grossSalesMinor),
  returningShare: (f: ShopFacts) =>
    ratio(f.returningCustomers, f.newCustomers + f.returningCustomers),
} as const;

/** Blended efficiency across shop + ads (MER = revenue / ad spend). */
export const blendedMetrics = {
  mer: (shop: ShopFacts, ads: AdFacts) =>
    ratio(shop.netSalesMinor, ads.spendMinor),
  /** Contribution before COGS/shipping (those land with the finance module). */
  netAfterAdSpendMinor: (shop: ShopFacts, ads: AdFacts) =>
    shop.netSalesMinor - ads.spendMinor,
} as const;

export function sumAdFacts(rows: AdFacts[]): AdFacts {
  return rows.reduce<AdFacts>(
    (acc, r) => ({
      spendMinor: acc.spendMinor + r.spendMinor,
      revenueMinor: acc.revenueMinor + r.revenueMinor,
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      purchases: acc.purchases + r.purchases,
      reach: acc.reach + r.reach,
      videoViews3s: acc.videoViews3s + r.videoViews3s,
      videoPlays: acc.videoPlays + r.videoPlays,
    }),
    {
      spendMinor: 0,
      revenueMinor: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      reach: 0,
      videoViews3s: 0,
      videoPlays: 0,
    },
  );
}

export function sumShopFacts(rows: ShopFacts[]): ShopFacts {
  return rows.reduce<ShopFacts>(
    (acc, r) => ({
      grossSalesMinor: acc.grossSalesMinor + r.grossSalesMinor,
      netSalesMinor: acc.netSalesMinor + r.netSalesMinor,
      refundsMinor: acc.refundsMinor + r.refundsMinor,
      orders: acc.orders + r.orders,
      sessions: acc.sessions + r.sessions,
      newCustomers: acc.newCustomers + r.newCustomers,
      returningCustomers: acc.returningCustomers + r.returningCustomers,
    }),
    {
      grossSalesMinor: 0,
      netSalesMinor: 0,
      refundsMinor: 0,
      orders: 0,
      sessions: 0,
      newCustomers: 0,
      returningCustomers: 0,
    },
  );
}
