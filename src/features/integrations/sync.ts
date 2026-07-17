import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  campaigns,
  adInsightsDaily,
  integrationConnections,
  syncCursors,
} from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { createMetaProvider } from "./meta";
import { createMockAdsProvider } from "./mock";
import type { AdsProvider, ProviderCredentials } from "./types";
import { ProviderAuthError } from "./types";
import type { ClaimedJob } from "@/lib/jobs/queue";

/**
 * Sync job handler: connection → provider → entities + daily facts.
 * Idempotent by construction — campaigns and insights are natural-key
 * upserts, so re-runs and restatement lookbacks are safe.
 * Credential precedence for Meta: a per-connection secret (OAuth or a
 * pasted token) wins if one exists; otherwise falls back to the one
 * agency-wide META_USER_TOKEN, if set; otherwise the deterministic mock
 * (lets the whole pipeline be exercised end-to-end before any real
 * connector). This lets per-client connections and one shared agency
 * token coexist — a connection only needs its own secret row if it's
 * meant to override the shared token.
 */

const LOOKBACK_DAYS = 28;

function resolveProvider(
  provider: string,
  hasLiveCreds: boolean,
): AdsProvider | null {
  if (provider === "meta" && hasLiveCreds) return createMetaProvider();
  if (provider === "meta" || provider === "google_ads" || provider === "tiktok") {
    return createMockAdsProvider(provider);
  }
  return null; // shopify etc. have their own handlers (Phase 6)
}

export async function runSyncJob(job: ClaimedJob): Promise<void> {
  if (!job.connectionId) throw new Error("sync job missing connectionId");
  const db = getDb();

  const connection = await db.query.integrationConnections.findFirst({
    where: (c, { eq: eqOp }) => eqOp(c.id, job.connectionId!),
  });
  if (!connection) throw new Error(`connection ${job.connectionId} not found`);

  const secret = await db.query.integrationSecrets.findFirst({
    where: (s, { eq: eqOp }) => eqOp(s.connectionId, connection.id),
  });

  let creds: ProviderCredentials = { accessToken: "mock" };
  let hasLiveCreds = false;

  if (secret?.encryptedPayload) {
    const parsed = JSON.parse(decryptSecret(secret.encryptedPayload)) as {
      accessToken: string;
    };
    creds = {
      accessToken: parsed.accessToken,
      extra: { currency: connection.currencyCode ?? "INR" },
    };
    hasLiveCreds = true;
  } else if (connection.provider === "meta" && env.META_USER_TOKEN) {
    creds = {
      accessToken: env.META_USER_TOKEN,
      extra: { currency: connection.currencyCode ?? "INR" },
    };
    hasLiveCreds = true;
  }

  const provider = resolveProvider(connection.provider, hasLiveCreds);
  if (!provider) throw new Error(`no ads provider for ${connection.provider}`);

  try {
    // 1. Campaign entities (paginated, cursor persisted per page).
    let campaignCursor: string | undefined;
    do {
      const page = await provider.listCampaigns(
        creds,
        connection.externalAccountId,
        campaignCursor,
      );
      // Best-effort campaign-grain rankings — never blocks the entity sync.
      const rankings = provider.getRankings
        ? await provider.getRankings(creds, connection.externalAccountId)
        : {};
      for (const c of page.items) {
        const rank = rankings[c.externalId];
        await db
          .insert(campaigns)
          .values({
            orgId: connection.orgId,
            workspaceId: connection.workspaceId,
            connectionId: connection.id,
            provider: connection.provider,
            externalId: c.externalId,
            name: c.name,
            status: c.status,
            objective: c.objective,
            dailyBudgetMinor: c.dailyBudgetMinor,
            currencyCode: c.currencyCode,
            qualityRanking: c.qualityRanking ?? rank?.qualityRanking,
            engagementRateRanking: c.engagementRateRanking ?? rank?.engagementRateRanking,
            conversionRateRanking: c.conversionRateRanking ?? rank?.conversionRateRanking,
          })
          .onConflictDoUpdate({
            target: [campaigns.connectionId, campaigns.externalId],
            set: {
              name: c.name,
              status: c.status,
              objective: c.objective,
              dailyBudgetMinor: c.dailyBudgetMinor,
              qualityRanking: c.qualityRanking ?? rank?.qualityRanking,
              engagementRateRanking: c.engagementRateRanking ?? rank?.engagementRateRanking,
              conversionRateRanking: c.conversionRateRanking ?? rank?.conversionRateRanking,
              updatedAt: new Date(),
            },
          });
      }
      campaignCursor = page.nextCursor;
    } while (campaignCursor);

    // 2. Daily insights with restatement lookback.
    const backfillDays =
      typeof job.payload.backfillDays === "number"
        ? job.payload.backfillDays
        : LOOKBACK_DAYS;
    const until = new Date().toISOString().slice(0, 10);
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - backfillDays);
    const since = sinceDate.toISOString().slice(0, 10);

    // Map external campaign ids → internal ids once.
    const campaignRows = await db.query.campaigns.findMany({
      where: (c, { eq: eqOp }) => eqOp(c.connectionId, connection.id),
      columns: { id: true, externalId: true },
    });
    const idByExternal = new Map(campaignRows.map((c) => [c.externalId, c.id]));

    let insightCursor: string | undefined;
    do {
      const page = await provider.getDailyInsights(
        creds,
        connection.externalAccountId,
        { since, until },
        insightCursor,
      );
      for (const r of page.items) {
        const campaignId = idByExternal.get(r.campaignExternalId);
        if (!campaignId) continue; // campaign appeared mid-page; next run catches it
        await db
          .insert(adInsightsDaily)
          .values({
            orgId: connection.orgId,
            workspaceId: connection.workspaceId,
            campaignId,
            provider: connection.provider,
            date: r.date,
            spendMinor: r.spendMinor,
            revenueMinor: r.revenueMinor,
            currencyCode: r.currencyCode,
            impressions: r.impressions,
            clicks: r.clicks,
            purchases: r.purchases,
            reach: r.reach,
            videoViews3s: r.videoViews3s,
            videoPlays: r.videoPlays,
            inlineLinkClicks: r.inlineLinkClicks,
            outboundClicks: r.outboundClicks,
            uniqueClicks: r.uniqueClicks,
            landingPageViews: r.landingPageViews,
            pageEngagements: r.pageEngagements,
            videoThruplays: r.videoThruplays,
            videoP50: r.videoP50,
            videoP75: r.videoP75,
            videoP100: r.videoP100,
            viewContent: r.viewContent,
            addToCart: r.addToCart,
            initiateCheckout: r.initiateCheckout,
            addPaymentInfo: r.addPaymentInfo,
            leads: r.leads,
          })
          .onConflictDoUpdate({
            target: [adInsightsDaily.campaignId, adInsightsDaily.date],
            set: {
              spendMinor: r.spendMinor,
              revenueMinor: r.revenueMinor,
              impressions: r.impressions,
              clicks: r.clicks,
              purchases: r.purchases,
              reach: r.reach,
              videoViews3s: r.videoViews3s,
              videoPlays: r.videoPlays,
              inlineLinkClicks: r.inlineLinkClicks,
              outboundClicks: r.outboundClicks,
              uniqueClicks: r.uniqueClicks,
              landingPageViews: r.landingPageViews,
              pageEngagements: r.pageEngagements,
              videoThruplays: r.videoThruplays,
              videoP50: r.videoP50,
              videoP75: r.videoP75,
              videoP100: r.videoP100,
              viewContent: r.viewContent,
              addToCart: r.addToCart,
              initiateCheckout: r.initiateCheckout,
              addPaymentInfo: r.addPaymentInfo,
              leads: r.leads,
              updatedAt: new Date(),
            },
          });
      }
      insightCursor = page.nextCursor;
      await db
        .insert(syncCursors)
        .values({
          connectionId: connection.id,
          resource: "insights.daily",
          cursor: { lastRun: until, pageCursor: insightCursor ?? null },
        })
        .onConflictDoUpdate({
          target: [syncCursors.connectionId, syncCursors.resource],
          set: {
            cursor: { lastRun: until, pageCursor: insightCursor ?? null },
            updatedAt: new Date(),
          },
        });
    } while (insightCursor);

    await db
      .update(integrationConnections)
      .set({ lastSyncAt: new Date(), lastError: null })
      .where(eq(integrationConnections.id, connection.id));
  } catch (error) {
    if (error instanceof ProviderAuthError) {
      await db
        .update(integrationConnections)
        .set({
          status: "reauth_required",
          lastErrorAt: new Date(),
          lastError: "Authentication expired — reconnect the account.",
        })
        .where(
          and(
            eq(integrationConnections.id, connection.id),
            eq(integrationConnections.orgId, connection.orgId),
          ),
        );
    } else {
      await db
        .update(integrationConnections)
        .set({
          lastErrorAt: new Date(),
          lastError: error instanceof Error ? error.message : "Unknown sync error",
        })
        .where(eq(integrationConnections.id, connection.id));
    }
    throw error; // queue handles retry/backoff
  }
}
