import { describe, expect, it } from "vitest";
import {
  adMetrics,
  blendedMetrics,
  shopMetrics,
  sumAdFacts,
  sumShopFacts,
  type AdFacts,
  type ShopFacts,
} from "../src/lib/metrics/definitions";

const ad = (overrides: Partial<AdFacts> = {}): AdFacts => ({
  spendMinor: 100_000,
  revenueMinor: 350_000,
  impressions: 50_000,
  clicks: 1_000,
  purchases: 25,
  reach: 30_000,
  videoViews3s: 15_000,
  videoPlays: 28_000,
  ...overrides,
});

const shop = (overrides: Partial<ShopFacts> = {}): ShopFacts => ({
  grossSalesMinor: 500_000,
  netSalesMinor: 480_000,
  refundsMinor: 20_000,
  orders: 40,
  sessions: 2_000,
  newCustomers: 30,
  returningCustomers: 10,
  ...overrides,
});

describe("ad metrics", () => {
  it("computes ROAS as revenue / spend", () => {
    expect(adMetrics.roas(ad())).toBeCloseTo(3.5);
  });
  it("computes CTR, CPC, CPM, CPA, frequency", () => {
    const f = ad();
    expect(adMetrics.ctr(f)).toBeCloseTo(0.02);
    expect(adMetrics.cpc(f)).toBeCloseTo(100);
    expect(adMetrics.cpm(f)).toBeCloseTo(2000);
    expect(adMetrics.cpa(f)).toBeCloseTo(4000);
    expect(adMetrics.frequency(f)).toBeCloseTo(50_000 / 30_000);
  });
  it("never divides by zero", () => {
    const empty = ad({
      spendMinor: 0,
      revenueMinor: 0,
      impressions: 0,
      clicks: 0,
      purchases: 0,
      reach: 0,
    });
    expect(adMetrics.roas(empty)).toBe(0);
    expect(adMetrics.ctr(empty)).toBe(0);
    expect(adMetrics.cpa(empty)).toBe(0);
    expect(adMetrics.frequency(empty)).toBe(0);
  });
});

describe("shop metrics", () => {
  it("computes AOV and conversion rate", () => {
    expect(shopMetrics.aov(shop())).toBeCloseTo(12_000);
    expect(shopMetrics.conversionRate(shop())).toBeCloseTo(0.02);
  });
  it("computes refund rate against gross", () => {
    expect(shopMetrics.refundRate(shop())).toBeCloseTo(0.04);
  });
  it("computes returning share of all customers", () => {
    expect(shopMetrics.returningShare(shop())).toBeCloseTo(0.25);
  });
});

describe("blended metrics", () => {
  it("computes MER as net revenue / ad spend", () => {
    expect(blendedMetrics.mer(shop(), ad())).toBeCloseTo(4.8);
  });
  it("computes net after ad spend in minor units", () => {
    expect(blendedMetrics.netAfterAdSpendMinor(shop(), ad())).toBe(380_000);
  });
});

describe("aggregation", () => {
  it("sums ad facts field-wise", () => {
    const total = sumAdFacts([ad(), ad()]);
    expect(total.spendMinor).toBe(200_000);
    expect(total.purchases).toBe(50);
  });
  it("sums shop facts field-wise and empty input is all zeros", () => {
    expect(sumShopFacts([shop(), shop()]).orders).toBe(80);
    expect(sumShopFacts([]).netSalesMinor).toBe(0);
  });
  it("ratios computed on aggregates equal weighted averages, not averaged ratios", () => {
    const a = ad({ spendMinor: 100_000, revenueMinor: 100_000 }); // 1.0x
    const b = ad({ spendMinor: 300_000, revenueMinor: 1_200_000 }); // 4.0x
    // Correct blended ROAS is 1.3M / 400k = 3.25x — NOT (1+4)/2 = 2.5x.
    expect(adMetrics.roas(sumAdFacts([a, b]))).toBeCloseTo(3.25);
  });
});
