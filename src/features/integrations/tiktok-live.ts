import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { integrationSecrets } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { env, isDemoMode } from "@/lib/env";
import { createTikTokProvider, refreshTikTokToken } from "./tiktok";
import { ProviderAuthError, ProviderRateLimitError, type CampaignRecord, type ProviderCredentials } from "./types";
import { sumAdFacts, type AdFacts } from "@/lib/metrics/definitions";
import type { DateRange } from "@/features/metrics/queries";

/**
 * On-demand TikTok reporting — same "pull-on-demand, not synced" shape as
 * meta-live.ts / google-ads-live.ts. Token handling is reactive rather
 * than proactive (see tiktok.ts's file-level comment on why TikTok's
 * token-lifetime model is genuinely uncertain from available docs): every
 * call tries the stored access token first, and only exchanges the
 * refresh token — then persists the result — if that first attempt comes
 * back as an auth failure. Accounts with no refresh token on file (or no
 * TIKTOK_APP_ID/SECRET configured to redeem one) just surface the auth
 * error normally, same as every other provider's expired-credential path.
 *
 * cached/INSIGHTS_TTL_MS/reasonFor/logTikTokFailure/withCreds are exported
 * for tiktok-breakdowns-live.ts to reuse — same cache, same failure
 * classification, same credential-resolution-with-retry logic for the
 * deeper ad-level/audience reports, rather than a second copy of any of it.
 */

interface CacheEntry<T> {
  expires: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();

export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.value as T;
  const value = await compute();
  cache.set(key, { expires: now + ttlMs, value });
  return value;
}

export const INSIGHTS_TTL_MS = 60_000;
const HEALTH_TTL_MS = 5 * 60_000;

export function reasonFor(e: unknown): string {
  if (e instanceof ProviderAuthError) return e.message;
  if (e instanceof ProviderRateLimitError) return "TikTok rate-limited this request — try again in a minute.";
  if (e instanceof Error) return e.message;
  return "Unknown error reaching TikTok.";
}

export function logTikTokFailure(connectionLabel: string, e: unknown): void {
  console.error(`[tiktok-live] ${connectionLabel}: ${reasonFor(e)}`, e);
}

export interface LiveCampaign {
  id: string;
  name: string;
  status: string;
  qualityRanking: string | null;
  engagementRateRanking: string | null;
  conversionRateRanking: string | null;
  dailyBudgetMinor: number | null;
  facts: AdFacts;
}

export interface TikTokFetchFailure {
  displayName: string;
  reason: string;
}

export interface LiveTikTokReport {
  totals: AdFacts;
  trend: Array<{ date: string; spendMinor: number; revenueMinor: number }>;
  campaigns: LiveCampaign[];
  partialFailure: boolean;
  failures: TikTokFetchFailure[];
}

interface StoredTikTokSecret {
  accessToken: string;
  refreshToken?: string;
}

async function resolveStoredSecret(connectionId: string): Promise<StoredTikTokSecret | null> {
  const db = getDb();
  const secret = await db.query.integrationSecrets.findFirst({
    where: (s, { eq: eqOp }) => eqOp(s.connectionId, connectionId),
  });
  if (!secret?.encryptedPayload) return null;
  return JSON.parse(decryptSecret(secret.encryptedPayload)) as StoredTikTokSecret;
}

async function refreshAndPersist(connectionId: string, refreshToken: string): Promise<string> {
  const appId = env.TIKTOK_APP_ID;
  const appSecret = env.TIKTOK_APP_SECRET;
  if (!appId || !appSecret) {
    throw new ProviderAuthError(
      "TikTok token needs refreshing but TIKTOK_APP_ID/TIKTOK_APP_SECRET aren't configured — reconnect in Settings.",
    );
  }
  const result = await refreshTikTokToken(appId, appSecret, refreshToken);
  const db = getDb();
  await db
    .update(integrationSecrets)
    .set({
      encryptedPayload: encryptSecret(
        JSON.stringify({ accessToken: result.accessToken, refreshToken: result.refreshToken }),
      ),
      rotatedAt: new Date(),
    })
    .where(eq(integrationSecrets.connectionId, connectionId));
  return result.accessToken;
}

/**
 * Resolves credentials and runs `fn`, retrying exactly once with a
 * refreshed access token if the first attempt fails with an auth error and
 * a refresh token is on file. Successful refreshes are persisted so the
 * NEXT call doesn't need to refresh again.
 */
export async function withCreds<T>(
  connection: { id: string; displayName: string; currencyCode: string | null },
  fn: (creds: ProviderCredentials) => Promise<T>,
): Promise<T> {
  const stored = await resolveStoredSecret(connection.id);
  if (!stored) {
    throw new Error("No access token available for this account — connect it in Settings.");
  }
  const extra = { currency: connection.currencyCode ?? "USD" };
  try {
    return await fn({ accessToken: stored.accessToken, extra });
  } catch (e) {
    if (e instanceof ProviderAuthError && stored.refreshToken) {
      const freshAccessToken = await refreshAndPersist(connection.id, stored.refreshToken);
      return await fn({ accessToken: freshAccessToken, extra });
    }
    throw e;
  }
}

interface ConnectionReport {
  campaigns: LiveCampaign[];
  trend: Array<{ date: string; spendMinor: number; revenueMinor: number }>;
}

async function fetchConnectionReport(
  creds: ProviderCredentials,
  accountId: string,
  range: DateRange,
): Promise<ConnectionReport> {
  const provider = createTikTokProvider();

  const campaignById = new Map<string, CampaignRecord>();
  let campaignCursor: string | undefined;
  do {
    const page = await provider.listCampaigns(creds, accountId, campaignCursor);
    for (const c of page.items) campaignById.set(c.externalId, c);
    campaignCursor = page.nextCursor;
  } while (campaignCursor);

  const dailyByCampaign = new Map<string, AdFacts[]>();
  const dailyTotals = new Map<string, { spendMinor: number; revenueMinor: number }>();
  let insightCursor: string | undefined;
  do {
    const page = await provider.getDailyInsights(creds, accountId, range, insightCursor);
    for (const row of page.items) {
      const list = dailyByCampaign.get(row.campaignExternalId) ?? [];
      list.push(row);
      dailyByCampaign.set(row.campaignExternalId, list);

      const t = dailyTotals.get(row.date) ?? { spendMinor: 0, revenueMinor: 0 };
      t.spendMinor += row.spendMinor;
      t.revenueMinor += row.revenueMinor;
      dailyTotals.set(row.date, t);
    }
    insightCursor = page.nextCursor;
  } while (insightCursor);

  const campaigns: LiveCampaign[] = [...campaignById.values()].map((c) => ({
    id: c.externalId,
    name: c.name,
    status: c.status,
    qualityRanking: null,
    engagementRateRanking: null,
    conversionRateRanking: null,
    dailyBudgetMinor: c.dailyBudgetMinor ?? null,
    facts: sumAdFacts(dailyByCampaign.get(c.externalId) ?? []),
  }));

  const trend = [...dailyTotals.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { campaigns, trend };
}

/** Live report for every active TikTok connection under a workspace —
 *  mirrors getLiveMetaReport / getLiveGoogleAdsReport. */
export async function getLiveTikTokReport(workspaceId: string, range: DateRange): Promise<LiveTikTokReport> {
  const empty: LiveTikTokReport = {
    totals: sumAdFacts([]),
    trend: [],
    campaigns: [],
    partialFailure: false,
    failures: [],
  };
  if (isDemoMode) return empty;

  const db = getDb();
  const connections = await db.query.integrationConnections.findMany({
    where: (c, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "tiktok"), eqOp(c.status, "active")),
  });
  if (connections.length === 0) return empty;

  const failures: TikTokFetchFailure[] = [];

  const perConnection = await Promise.all(
    connections.map(async (connection) => {
      try {
        const cacheKey = `tiktok:${connection.id}:${range.since}:${range.until}`;
        return await cached(cacheKey, INSIGHTS_TTL_MS, () =>
          withCreds(connection, (creds) => fetchConnectionReport(creds, connection.externalAccountId, range)),
        );
      } catch (e) {
        failures.push({ displayName: connection.displayName, reason: reasonFor(e) });
        logTikTokFailure(connection.displayName, e);
        return null;
      }
    }),
  );

  const reports = perConnection.filter((r): r is ConnectionReport => r !== null);
  const campaigns = reports.flatMap((r) => r.campaigns);

  const trendMap = new Map<string, { spendMinor: number; revenueMinor: number }>();
  for (const r of reports) {
    for (const t of r.trend) {
      const e = trendMap.get(t.date) ?? { spendMinor: 0, revenueMinor: 0 };
      e.spendMinor += t.spendMinor;
      e.revenueMinor += t.revenueMinor;
      trendMap.set(t.date, e);
    }
  }
  const trend = [...trendMap.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totals = sumAdFacts(campaigns.map((c) => c.facts));

  return { totals, trend, campaigns, partialFailure: failures.length > 0, failures };
}

export interface PacingResult {
  activeDailyBudgetMinor: number;
  spendTodayMinor: number;
  partialFailure: boolean;
}

/** "Pacing" for today — mirrors getMetaPacing/getGoogleAdsPacing. Note
 *  many TikTok campaigns manage budget at the ad-group level (see
 *  tiktok.ts's dailyBudgetMinor mapping), so activeDailyBudgetMinor can
 *  legitimately read 0 even with active, spending campaigns. */
export async function getTikTokPacing(workspaceId: string): Promise<PacingResult> {
  const empty: PacingResult = { activeDailyBudgetMinor: 0, spendTodayMinor: 0, partialFailure: false };
  if (isDemoMode) return empty;

  const db = getDb();
  const connections = await db.query.integrationConnections.findMany({
    where: (c, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "tiktok"), eqOp(c.status, "active")),
  });
  if (connections.length === 0) return empty;

  const todayIso = new Date().toISOString().slice(0, 10);
  const range: DateRange = { since: todayIso, until: todayIso };
  let partialFailure = false;

  const perConnection = await Promise.all(
    connections.map(async (connection) => {
      try {
        const cacheKey = `tiktok-pacing:${connection.id}:${todayIso}`;
        return await cached(cacheKey, INSIGHTS_TTL_MS, () =>
          withCreds(connection, (creds) => fetchConnectionReport(creds, connection.externalAccountId, range)),
        );
      } catch (e) {
        partialFailure = true;
        logTikTokFailure(connection.displayName, e);
        return null;
      }
    }),
  );

  const reports = perConnection.filter((r): r is ConnectionReport => r !== null);
  const allCampaigns = reports.flatMap((r) => r.campaigns);
  const activeDailyBudgetMinor = allCampaigns
    .filter((c) => c.status === "active")
    .reduce((sum, c) => sum + (c.dailyBudgetMinor ?? 0), 0);
  const spendTodayMinor = allCampaigns.reduce((sum, c) => sum + c.facts.spendMinor, 0);

  return { activeDailyBudgetMinor, spendTodayMinor, partialFailure };
}

export type AccountHealth = "live" | "idle" | "no_access";

export interface AccountHealthResult {
  connectionId: string;
  displayName: string;
  health: AccountHealth;
  /** Why the probe failed, when it did — surfaced in the UI so an operator
   * doesn't have to open the Vercel function log to tell causes apart. */
  reason?: string;
}

interface HealthProbe {
  health: AccountHealth;
  reason?: string;
}

/** Cheap per-account health probe — mirrors checkMetaAccountsHealth. */
export async function checkTikTokAccountsHealth(workspaceId: string): Promise<AccountHealthResult[]> {
  if (isDemoMode) return [];

  const db = getDb();
  const connections = await db.query.integrationConnections.findMany({
    where: (c, { and: andOp, eq: eqOp }) => andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "tiktok")),
  });
  if (connections.length === 0) return [];

  const provider = createTikTokProvider();
  const since = new Date();
  since.setDate(since.getDate() - 6);
  const range: DateRange = { since: since.toISOString().slice(0, 10), until: new Date().toISOString().slice(0, 10) };

  return Promise.all(
    connections.map(async (connection) => {
      // v2 key: the cached shape changed from a bare string to an object.
      const cacheKey = `tiktok-health2:${connection.id}`;
      const probe = await cached<HealthProbe>(cacheKey, HEALTH_TTL_MS, async () => {
        try {
          const page = await withCreds(connection, (creds) =>
            provider.getDailyInsights(creds, connection.externalAccountId, range),
          );
          const spend = page.items.reduce((sum, r) => sum + r.spendMinor, 0);
          return { health: spend > 0 ? "live" : "idle" };
        } catch (e) {
          logTikTokFailure(connection.displayName, e);
          return { health: "no_access", reason: reasonFor(e) };
        }
      });
      return {
        connectionId: connection.id,
        displayName: connection.displayName,
        health: probe.health,
        reason: probe.reason,
      };
    }),
  );
}
