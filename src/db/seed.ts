/**
 * Live-database seed: creates a demo agency org + workspaces + CRM rows +
 * 30 days of fact data using the SAME deterministic generator demo mode
 * uses, so a freshly-connected Supabase project has populated dashboards
 * before any real connector syncs.
 *
 * Run: DATABASE_URL=postgres://... npm run db:seed
 * Idempotent: safe to re-run (slug + natural-key upserts).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import {
  demoWorkspaces,
  demoAdInsights,
  demoShopSales,
  demoCampaigns,
  demoContacts,
} from "../features/demo-data/generator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  const [org] = await db
    .insert(schema.organizations)
    .values({ name: "ComeDigit Agency", slug: "comedigit-agency" })
    .onConflictDoUpdate({
      target: schema.organizations.slug,
      set: { name: "ComeDigit Agency" },
    })
    .returning();
  console.log(`org: ${org.id}`);

  for (const ws of demoWorkspaces) {
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ orgId: org.id, name: ws.name, slug: ws.slug })
      .onConflictDoUpdate({
        target: [schema.workspaces.orgId, schema.workspaces.slug],
        set: { name: ws.name },
      })
      .returning();

    // Shopify daily facts (connectionId is a placeholder until Phase 6).
    const [shopConn] = await db
      .insert(schema.integrationConnections)
      .values({
        orgId: org.id,
        workspaceId: workspace.id,
        provider: "shopify",
        externalAccountId: `${ws.slug}.myshopify.com`,
        displayName: `${ws.name} Store (seed)`,
        status: "paused",
      })
      .onConflictDoUpdate({
        target: [
          schema.integrationConnections.workspaceId,
          schema.integrationConnections.provider,
          schema.integrationConnections.externalAccountId,
        ],
        set: { displayName: `${ws.name} Store (seed)` },
      })
      .returning();

    for (const day of demoShopSales(ws.id, 30)) {
      await db
        .insert(schema.shopSalesDaily)
        .values({
          orgId: org.id,
          workspaceId: workspace.id,
          connectionId: shopConn.id,
          date: day.date,
          grossSalesMinor: day.grossSalesMinor,
          netSalesMinor: day.netSalesMinor,
          refundsMinor: day.refundsMinor,
          orders: day.orders,
          sessions: day.sessions,
          newCustomers: day.newCustomers,
          returningCustomers: day.returningCustomers,
        })
        .onConflictDoUpdate({
          target: [schema.shopSalesDaily.connectionId, schema.shopSalesDaily.date],
          set: { netSalesMinor: day.netSalesMinor, orders: day.orders },
        });
    }

    // Ads: one paused seed connection per provider with campaigns + facts.
    for (const provider of ["meta", "google_ads", "tiktok"] as const) {
      const [conn] = await db
        .insert(schema.integrationConnections)
        .values({
          orgId: org.id,
          workspaceId: workspace.id,
          provider,
          externalAccountId: `seed-${ws.slug}-${provider}`,
          displayName: `${ws.name} ${provider} (seed)`,
          status: "paused",
        })
        .onConflictDoUpdate({
          target: [
            schema.integrationConnections.workspaceId,
            schema.integrationConnections.provider,
            schema.integrationConnections.externalAccountId,
          ],
          set: { displayName: `${ws.name} ${provider} (seed)` },
        })
        .returning();

      const campaignIds = new Map<string, string>();
      for (const c of demoCampaigns(ws.id, provider)) {
        const [row] = await db
          .insert(schema.campaigns)
          .values({
            orgId: org.id,
            workspaceId: workspace.id,
            connectionId: conn.id,
            provider,
            externalId: c.id,
            name: c.name,
            status: c.status,
          })
          .onConflictDoUpdate({
            target: [schema.campaigns.connectionId, schema.campaigns.externalId],
            set: { name: c.name, status: c.status },
          })
          .returning();
        campaignIds.set(c.id, row.id);
      }

      const firstCampaign = [...campaignIds.values()][0];
      for (const day of demoAdInsights(ws.id, provider, 30)) {
        await db
          .insert(schema.adInsightsDaily)
          .values({
            orgId: org.id,
            workspaceId: workspace.id,
            campaignId: firstCampaign,
            provider,
            date: day.date,
            spendMinor: day.spendMinor,
            revenueMinor: day.revenueMinor,
            impressions: day.impressions,
            clicks: day.clicks,
            purchases: day.purchases,
            reach: day.reach,
            videoViews3s: day.videoViews3s,
            videoPlays: day.videoPlays,
          })
          .onConflictDoUpdate({
            target: [schema.adInsightsDaily.campaignId, schema.adInsightsDaily.date],
            set: { spendMinor: day.spendMinor, revenueMinor: day.revenueMinor },
          });
      }
    }
    console.log(`workspace seeded: ${ws.name}`);
  }

  // CRM contacts.
  const wsRows = await db.query.workspaces.findMany({
    where: (w, { eq }) => eq(w.orgId, org.id),
  });
  const bySlug = new Map(wsRows.map((w) => [w.slug, w.id]));
  const slugById = new Map(demoWorkspaces.map((w) => [w.id, w.slug]));
  for (const c of demoContacts()) {
    const wsId = bySlug.get(slugById.get(c.workspaceId) ?? "");
    if (!wsId) continue;
    const exists = await db.query.contacts.findFirst({
      where: (row, { and, eq }) =>
        and(eq(row.workspaceId, wsId), eq(row.email, c.email)),
    });
    if (exists) continue;
    await db.insert(schema.contacts).values({
      orgId: org.id,
      workspaceId: wsId,
      fullName: c.fullName,
      title: c.title,
      email: c.email,
      phone: c.phone,
    });
  }

  console.log("seed complete");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
