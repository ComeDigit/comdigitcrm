import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  date,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { organizations, workspaces } from "./tenancy";
import { providerEnum } from "./ops";

/**
 * Metrics core: entity tables (slowly changing) + fact tables (daily grain).
 *
 * Conventions (fixed in Phase 1 architecture):
 * - Money: integer minor units + currency code. Never floats.
 * - Ratios (ROAS/CTR/CPA/AOV…) are NEVER stored — computed in
 *   src/lib/metrics/definitions.ts from base facts.
 * - Facts are idempotent upserts keyed on natural keys, so ad-platform
 *   restatement (28-day lookback re-pulls) is safe.
 * - `date` is in the source account's reporting timezone so our daily
 *   totals match the platform UI.
 */

export const entityStatusEnum = pgEnum("entity_status", [
  "active",
  "paused",
  "archived",
  "deleted",
]);

/** One row per ad campaign across all providers. */
export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    provider: providerEnum("provider").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    status: entityStatusEnum("status").notNull().default("active"),
    objective: text("objective"),
    dailyBudgetMinor: bigint("daily_budget_minor", { mode: "number" }),
    currencyCode: text("currency_code").notNull().default("INR"),
    /** Meta's own categorical ad-quality signals — "above_average" / "average" / "below_average" / null (not enough data). */
    qualityRanking: text("quality_ranking"),
    engagementRateRanking: text("engagement_rate_ranking"),
    conversionRateRanking: text("conversion_rate_ranking"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("campaigns_natural_uq").on(t.connectionId, t.externalId),
    index("campaigns_ws_provider_idx").on(t.workspaceId, t.provider),
  ],
);

/**
 * Daily ad performance facts at campaign grain (ad-set/ad grain follow the
 * same pattern in their integration phases; campaign grain powers every
 * overview dashboard).
 */
export const adInsightsDaily = pgTable(
  "ad_insights_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    date: date("date").notNull(),
    spendMinor: bigint("spend_minor", { mode: "number" }).notNull().default(0),
    revenueMinor: bigint("revenue_minor", { mode: "number" }).notNull().default(0),
    currencyCode: text("currency_code").notNull().default("INR"),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    clicks: bigint("clicks", { mode: "number" }).notNull().default(0),
    purchases: integer("purchases").notNull().default(0),
    reach: bigint("reach", { mode: "number" }).notNull().default(0),
    videoViews3s: bigint("video_views_3s", { mode: "number" }).notNull().default(0),
    videoPlays: bigint("video_plays", { mode: "number" }).notNull().default(0),
    inlineLinkClicks: bigint("inline_link_clicks", { mode: "number" }).notNull().default(0),
    outboundClicks: bigint("outbound_clicks", { mode: "number" }).notNull().default(0),
    uniqueClicks: bigint("unique_clicks", { mode: "number" }).notNull().default(0),
    landingPageViews: bigint("landing_page_views", { mode: "number" }).notNull().default(0),
    pageEngagements: bigint("page_engagements", { mode: "number" }).notNull().default(0),
    videoThruplays: bigint("video_thruplays", { mode: "number" }).notNull().default(0),
    videoP50: bigint("video_p50", { mode: "number" }).notNull().default(0),
    videoP75: bigint("video_p75", { mode: "number" }).notNull().default(0),
    videoP100: bigint("video_p100", { mode: "number" }).notNull().default(0),
    viewContent: integer("view_content").notNull().default(0),
    addToCart: integer("add_to_cart").notNull().default(0),
    initiateCheckout: integer("initiate_checkout").notNull().default(0),
    addPaymentInfo: integer("add_payment_info").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_insights_natural_uq").on(t.campaignId, t.date),
    index("ad_insights_ws_date_idx").on(t.workspaceId, t.date),
  ],
);

/** Shopify store daily sales facts. */
export const shopSalesDaily = pgTable(
  "shop_sales_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    date: date("date").notNull(),
    grossSalesMinor: bigint("gross_sales_minor", { mode: "number" }).notNull().default(0),
    netSalesMinor: bigint("net_sales_minor", { mode: "number" }).notNull().default(0),
    refundsMinor: bigint("refunds_minor", { mode: "number" }).notNull().default(0),
    orders: integer("orders").notNull().default(0),
    newCustomers: integer("new_customers").notNull().default(0),
    returningCustomers: integer("returning_customers").notNull().default(0),
    sessions: bigint("sessions", { mode: "number" }).notNull().default(0),
    currencyCode: text("currency_code").notNull().default("INR"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shop_sales_natural_uq").on(t.connectionId, t.date),
    index("shop_sales_ws_date_idx").on(t.workspaceId, t.date),
  ],
);

/** Daily FX rates for cross-currency rollups (base: USD). */
export const fxRatesDaily = pgTable(
  "fx_rates_daily",
  {
    date: date("date").notNull(),
    currencyCode: text("currency_code").notNull(),
    /** Rate scaled by 1e6: 1 USD = rateMicros/1e6 units of currency. */
    rateMicros: bigint("rate_micros", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("fx_rates_uq").on(t.date, t.currencyCode)],
);
