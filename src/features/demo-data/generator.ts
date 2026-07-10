import type { AdFacts, ShopFacts } from "@/lib/metrics/definitions";

/**
 * Deterministic demo data. Zero API keys, zero randomness across reloads:
 * a seeded PRNG (mulberry32) means the same date range always renders the
 * same numbers — screenshots, tests, and demos stay stable.
 * Replaced by real fact-table queries the moment a Supabase project +
 * integrations are connected (same return shapes).
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface DemoWorkspace {
  id: string;
  name: string;
  slug: string;
  vertical: string;
}

export const demoOrg = {
  id: "demo-org",
  name: "ComeDigit Agency",
  currencyCode: "INR",
} as const;

export const demoWorkspaces: DemoWorkspace[] = [
  { id: "ws-makhana", name: "Makhanix Foods", slug: "makhanix", vertical: "D2C Snacks" },
  { id: "ws-green", name: "EatYourGreen", slug: "eatyourgreen", vertical: "Health Foods" },
  { id: "ws-aura", name: "Aura Skincare", slug: "aura", vertical: "Beauty" },
];

export type DemoProvider = "meta" | "google_ads" | "tiktok";

export interface DemoDailyAdRow extends AdFacts {
  date: string;
  provider: DemoProvider;
}

export interface DemoDailyShopRow extends ShopFacts {
  date: string;
}

const PROVIDER_PROFILES: Record<
  DemoProvider,
  { spendBase: number; roas: number; ctr: number; cpmMinor: number }
> = {
  meta: { spendBase: 18_000_00, roas: 3.4, ctr: 0.019, cpmMinor: 180_00 },
  google_ads: { spendBase: 11_000_00, roas: 4.1, ctr: 0.034, cpmMinor: 260_00 },
  tiktok: { spendBase: 6_000_00, roas: 2.3, ctr: 0.012, cpmMinor: 90_00 },
};

function dateRange(days: number, endOffset = 0): string[] {
  const out: string[] = [];
  const end = new Date();
  end.setDate(end.getDate() - endOffset);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Weekly seasonality + gentle growth + deterministic noise. */
function seasonal(rand: () => number, dayIndex: number, dow: number): number {
  const weekend = dow === 0 || dow === 6 ? 1.18 : 1.0; // D2C weekend lift
  const growth = 1 + dayIndex * 0.004;
  const noise = 0.82 + rand() * 0.36;
  return weekend * growth * noise;
}

export function demoAdInsights(
  workspaceId: string,
  provider: DemoProvider,
  days = 30,
): DemoDailyAdRow[] {
  const rand = mulberry32(hashString(`${workspaceId}:${provider}`));
  const profile = PROVIDER_PROFILES[provider];
  const wsScale = 0.6 + (hashString(workspaceId) % 100) / 100;

  return dateRange(days).map((date, i) => {
    const dow = new Date(date).getDay();
    const m = seasonal(rand, i, dow) * wsScale;
    const spendMinor = Math.round(profile.spendBase * m);
    const impressions = Math.round((spendMinor / profile.cpmMinor) * 1000);
    const clicks = Math.round(impressions * profile.ctr * (0.9 + rand() * 0.2));
    const revenueMinor = Math.round(
      spendMinor * profile.roas * (0.75 + rand() * 0.5),
    );
    const purchases = Math.max(1, Math.round(revenueMinor / 1_499_00));
    return {
      date,
      provider,
      spendMinor,
      revenueMinor,
      impressions,
      clicks,
      purchases,
      reach: Math.round(impressions / (1.6 + rand() * 0.8)),
      videoViews3s: Math.round(impressions * (0.28 + rand() * 0.1)),
      videoPlays: Math.round(impressions * (0.55 + rand() * 0.15)),
    };
  });
}

export function demoShopSales(workspaceId: string, days = 30): DemoDailyShopRow[] {
  const rand = mulberry32(hashString(`${workspaceId}:shopify`));
  const wsScale = 0.6 + (hashString(workspaceId) % 100) / 100;

  return dateRange(days).map((date, i) => {
    const dow = new Date(date).getDay();
    const m = seasonal(rand, i, dow) * wsScale;
    const orders = Math.max(3, Math.round(85 * m));
    const aovMinor = Math.round(1_150_00 * (0.85 + rand() * 0.3));
    const grossSalesMinor = orders * aovMinor;
    const refundsMinor = Math.round(grossSalesMinor * (0.015 + rand() * 0.02));
    const returningCustomers = Math.round(orders * (0.24 + rand() * 0.12));
    return {
      date,
      grossSalesMinor,
      netSalesMinor: grossSalesMinor - refundsMinor,
      refundsMinor,
      orders,
      sessions: Math.round(orders / (0.014 + rand() * 0.012)),
      newCustomers: orders - returningCustomers,
      returningCustomers,
    };
  });
}

export interface DemoCampaign {
  id: string;
  name: string;
  provider: DemoProvider;
  status: "active" | "paused";
  facts: AdFacts;
}

const CAMPAIGN_NAMES: Record<DemoProvider, string[]> = {
  meta: [
    "Prospecting | Broad | Advantage+",
    "Retargeting | 30d Engagers",
    "Prospecting | Lookalike 3%",
    "Catalog Sales | DPA",
  ],
  google_ads: [
    "PMax | All Products",
    "Search | Brand",
    "Search | Category Keywords",
    "Shopping | Best Sellers",
  ],
  tiktok: ["Spark Ads | UGC Batch 3", "Prospecting | Broad", "Retargeting | ATC 14d"],
};

export function demoCampaigns(
  workspaceId: string,
  provider: DemoProvider,
): DemoCampaign[] {
  const rand = mulberry32(hashString(`${workspaceId}:${provider}:campaigns`));
  const profile = PROVIDER_PROFILES[provider];
  return CAMPAIGN_NAMES[provider].map((name, i) => {
    const spendMinor = Math.round(profile.spendBase * 30 * (0.1 + rand() * 0.4));
    const impressions = Math.round((spendMinor / profile.cpmMinor) * 1000);
    const clicks = Math.round(impressions * profile.ctr * (0.8 + rand() * 0.4));
    const revenueMinor = Math.round(
      spendMinor * profile.roas * (0.55 + rand() * 0.9),
    );
    return {
      id: `${provider}-c${i}`,
      name,
      provider,
      status: rand() > 0.2 ? ("active" as const) : ("paused" as const),
      facts: {
        spendMinor,
        revenueMinor,
        impressions,
        clicks,
        purchases: Math.max(1, Math.round(revenueMinor / 1_499_00)),
        reach: Math.round(impressions / 2),
        videoViews3s: Math.round(impressions * 0.3),
        videoPlays: Math.round(impressions * 0.6),
      },
    };
  });
}

export interface DemoContact {
  id: string;
  fullName: string;
  title: string;
  email: string;
  phone: string;
  workspaceId: string;
}

export function demoContacts(): DemoContact[] {
  return [
    { id: "ct-1", fullName: "Riya Sharma", title: "Founder", email: "riya@makhanix.in", phone: "+91 98100 11223", workspaceId: "ws-makhana" },
    { id: "ct-2", fullName: "Arjun Mehta", title: "Marketing Head", email: "arjun@makhanix.in", phone: "+91 98100 44556", workspaceId: "ws-makhana" },
    { id: "ct-3", fullName: "Sneha Patel", title: "CEO", email: "sneha@eatyourgreen.com", phone: "+91 99870 77889", workspaceId: "ws-green" },
    { id: "ct-4", fullName: "Kabir Rao", title: "Ecom Manager", email: "kabir@aura.co.in", phone: "+91 90040 33221", workspaceId: "ws-aura" },
  ];
}

export interface DemoTask {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "review" | "done";
  workspaceId: string;
  dueDate: string;
  assignee: string;
}

export function demoTasks(): DemoTask[] {
  const d = (offset: number) => {
    const x = new Date();
    x.setDate(x.getDate() + offset);
    return x.toISOString().slice(0, 10);
  };
  return [
    { id: "t-1", title: "Launch Diwali gifting campaign", status: "in_progress", workspaceId: "ws-makhana", dueDate: d(3), assignee: "Priya" },
    { id: "t-2", title: "Refresh UGC creatives (fatigue on batch 2)", status: "todo", workspaceId: "ws-makhana", dueDate: d(5), assignee: "Dev" },
    { id: "t-3", title: "Monthly report — EatYourGreen", status: "review", workspaceId: "ws-green", dueDate: d(1), assignee: "Priya" },
    { id: "t-4", title: "Set up GA4 purchase event audit", status: "todo", workspaceId: "ws-green", dueDate: d(7), assignee: "Rahul" },
    { id: "t-5", title: "Negotiate Q3 retainer renewal", status: "in_progress", workspaceId: "ws-aura", dueDate: d(2), assignee: "Ankit" },
    { id: "t-6", title: "PMax asset group restructure", status: "done", workspaceId: "ws-aura", dueDate: d(-1), assignee: "Rahul" },
  ];
}
