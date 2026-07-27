import "server-only";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { env, isDemoMode } from "@/lib/env";
import { createGoogleAdsProvider, refreshAccessToken } from "./google-ads";
import { ProviderAuthError, ProviderRateLimitError, type CampaignRecord, type ProviderCredentials } from "./types";
import { sumAdFacts, type AdFacts } from "@/lib/metrics/definitions";
import type { DateRange } from "@/features/metrics/queries";

/**
 * On-demand Google Ads reporting — same "pull-on-demand, not synced" shape
 * as meta-live.ts. The one structural difference: Google Ads access tokens
 * expire hourly, so every live pull first turns a stored REFRESH token into
 * a short-lived access token (see getAccessToken's own 50-minute cache,
 * separate from the 60s report cache below — otherwise every report
 * refresh would also re-hit Google's token endpoint).
 */

interface CacheEntry<T> {
  expires: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();

/** Exported so google-ads-breakdowns-live.ts shares this exact cache
 *  instance (namespaced by key prefix) instead of running a second
 *  independent cache for what's conceptually the same live-pull
 *  mechanism — same reasoning as meta-live.ts's `cached`. */
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
// Google access tokens last ~3600s; refresh 10 minutes early so a slow
// request never straddles the actual expiry.
const ACCESS_TOKEN_TTL_MS = 50 * 60_000;

export function reasonFor(e: unknown): string {
  if (e instanceof ProviderAuthError) return e.message;
  if (e instanceof ProviderRateLimitError) return "Google Ads rate-limited this request — try again in a minute.";
  if (e instanceof Error) return e.message;
  return "Unknown error reaching Google Ads.";
}

export function logGoogleAdsFailure(connectionLabel: string, e: unknown): void {
  console.error(`[google-ads-live] ${connectionLabel}: ${reasonFor(e)}`, e);
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

export interface GoogleAdsFetchFailure {
  displayName: string;
  reason: string;
}

export interface LiveGoogleAdsReport {
  totals: AdFacts;
  trend: Array<{ date: string; spendMinor: number; revenueMinor: number }>;
  campaigns: LiveCampaign[];
  partialFailure: boolean;
  failures: GoogleAdsFetchFailure[];
}

async function getAccessToken(connectionId: string, refreshToken: string): Promise<string> {
  const { accessToken } = await cached(`gads-token:${connectionId}`, ACCESS_TOKEN_TTL_MS, () =>
    refreshAccessToken(refreshToken),
  );
  return accessToken;
}

export interface ResolvedGoogleAdsCreds extends ProviderCredentials {
  extra: Record<string, string>;
}

/**
 * Resolves a connection to a ready-to-use access token + agency-wide
 * developer token / login-customer-id. Falls back to
 * GOOGLE_ADS_REFRESH_TOKEN when the connection has no secret of its own —
 * this is what lets connectAgencyGoogleAdsAccounts save a connection with
 * NO per-connection secret and still work, exactly mirroring Meta's
 * META_USER_TOKEN fallback. Unlike Meta's resolveCreds (pure local
 * decrypt), this can throw — refreshing the access token is a network
 * call — so callers must try/catch around it, not just null-check.
 * Exported so google-ads-breakdowns-live.ts resolves credentials the
 * exact same way rather than duplicating the token-refresh dance.
 */
export async function resolveCreds(connection: {
  id: string;
  currencyCode: string | null;
}): Promise<ResolvedGoogleAdsCreds | null> {
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    throw new Error("Google Ads connector not configured — set GOOGLE_ADS_DEVELOPER_TOKEN.");
  }

  const db = getDb();
  const secret = await db.query.integrationSecrets.findFirst({
    where: (s, { eq }) => eq(s.connectionId, connection.id),
  });

  let refreshToken: string | undefined;
  if (secret?.encryptedPayload) {
    const parsed = JSON.parse(decryptSecret(secret.encryptedPayload)) as { refreshToken: string };
    refreshToken = parsed.refreshToken;
  } else if (env.GOOGLE_ADS_REFRESH_TOKEN) {
    refreshToken = env.GOOGLE_ADS_REFRESH_TOKEN;
  }
  if (!refreshToken) return null;

  const accessToken = await getAccessToken(connection.id, refreshToken);
  const extra: Record<string, string> = {
    developerToken,
    currency: connection.currencyCode ?? "USD",
  };
  if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) extra.loginCustomerId = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  return { accessToken, extra };
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
  const provider = createGoogleAdsProvider();

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
    qualityRanking: c.qualityRanking ?? null,
    engagementRateRanking: c.engagementRateRanking ?? null,
    conversionRateRanking: c.conversionRateRanking ?? null,
    dailyBudgetMinor: c.dailyBudgetMinor ?? null,
    facts: sumAdFacts(dailyByCampaign.get(c.externalId) ?? []),
  }));

  const trend = [...dailyTotals.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { campaigns, trend };
}

/**
 * Live report for every active Google Ads connection under a workspace,
 * merged into one totals/trend/campaigns set — mirrors getLiveMetaReport.
 * Returns all-zero/empty when there's nothing to fetch (demo mode, or no
 * active connection yet) rather than erroring.
 */
export async function getLiveGoogleAdsReport(
  workspaceId: string,
  range: DateRange,
): Promise<LiveGoogleAdsReport> {
  const empty: LiveGoogleAdsReport = {
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
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "google_ads"), eqOp(c.status, "active")),
  });
  if (connections.length === 0) return empty;

  const failures: GoogleAdsFetchFailure[] = [];

  const perConnection = await Promise.all(
    connections.map(async (connection) => {
      try {
        const creds = await resolveCreds(connection);
        if (!creds) {
          const reason =
            "No refresh token available for this account — connect it in Settings or set GOOGLE_ADS_REFRESH_TOKEN.";
          failures.push({ displayName: connection.displayName, reason });
          logGoogleAdsFailure(connection.displayName, new Error(reason));
          return null;
        }
        const cacheKey = `google_ads:${connection.id}:${range.since}:${range.until}`;
        return await cached(cacheKey, INSIGHTS_TTL_MS, () =>
          fetchConnectionReport(creds, connection.externalAccountId, range),
        );
      } catch (e) {
        failures.push({ displayName: connection.displayName, reason: reasonFor(e) });
        logGoogleAdsFailure(connection.displayName, e);
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

/** "Pacing" for today — mirrors getMetaPacing exactly, same rationale. */
export async function getGoogleAdsPacing(workspaceId: string): Promise<PacingResult> {
  const empty: PacingResult = { activeDailyBudgetMinor: 0, spendTodayMinor: 0, partialFailure: false };
  if (isDemoMode) return empty;

  const db = getDb();
  const connections = await db.query.integrationConnections.findMany({
    where: (c, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "google_ads"), eqOp(c.status, "active")),
  });
  if (connections.length === 0) return empty;

  const todayIso = new Date().toISOString().slice(0, 10);
  const range: DateRange = { since: todayIso, until: todayIso };
  let partialFailure = false;

  const perConnection = await Promise.all(
    connections.map(async (connection) => {
      try {
        const creds = await resolveCreds(connection);
        if (!creds) {
          partialFailure = true;
          logGoogleAdsFailure(connection.displayName, new Error("No refresh token available for pacing."));
          return null;
        }
        const cacheKey = `google_ads-pacing:${connection.id}:${todayIso}`;
        return await cached(cacheKey, INSIGHTS_TTL_MS, () =>
          fetchConnectionReport(creds, connection.externalAccountId, range),
        );
      } catch (e) {
        partialFailure = true;
        logGoogleAdsFailure(connection.displayName, e);
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
}

/** Cheap per-account health probe — mirrors checkMetaAccountsHealth. */
export async function checkGoogleAdsAccountsHealth(workspaceId: string): Promise<AccountHealthResult[]> {
  if (isDemoMode) return [];

  const db = getDb();
  const connections = await db.query.integrationConnections.findMany({
    where: (c, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "google_ads")),
  });
  if (connections.length === 0) return [];

  const provider = createGoogleAdsProvider();
  const since = new Date();
  since.setDate(since.getDate() - 6);
  const range: DateRange = { since: since.toISOString().slice(0, 10), until: new Date().toISOString().slice(0, 10) };

  return Promise.all(
    connections.map(async (connection) => {
      const cacheKey = `google_ads-health:${connection.id}`;
      const health = await cached<AccountHealth>(cacheKey, HEALTH_TTL_MS, async () => {
        try {
          const creds = await resolveCreds(connection);
          if (!creds) return "no_access";
          const page = await provider.getDailyInsights(creds, connection.externalAccountId, range);
          const spend = page.items.reduce((sum, r) => sum + r.spendMinor, 0);
          return spend > 0 ? "live" : "idle";
        } catch (e) {
          logGoogleAdsFailure(connection.displayName, e);
          return "no_access";
        }
      });
      return { connectionId: connection.id, displayName: connection.displayName, health };
    }),
  );
}
