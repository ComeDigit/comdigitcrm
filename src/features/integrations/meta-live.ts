import "server-only";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { env, isDemoMode } from "@/lib/env";
import { createMetaProvider } from "./meta";
import { ProviderAuthError, ProviderRateLimitError, type CampaignRecord, type ProviderCredentials } from "./types";
import { sumAdFacts, type AdFacts } from "@/lib/metrics/definitions";
import type { DateRange } from "@/features/metrics/queries";

/**
 * Turns a thrown error into a short, human-readable reason — shown in the
 * UI's partial-failure banner AND logged server-side, so a client's
 * "couldn't reach this account" isn't a black box. Previously these errors
 * were swallowed silently (just `partialFailure = true`), which made this
 * exact situation impossible to diagnose without SSH access to Vercel logs.
 */
function reasonFor(e: unknown): string {
  if (e instanceof ProviderAuthError) return "Meta rejected the token — it's likely expired or was revoked.";
  if (e instanceof ProviderRateLimitError) return "Meta rate-limited this request — try again in a minute.";
  if (e instanceof Error) return e.message;
  return "Unknown error reaching Meta.";
}

function logMetaFailure(connectionLabel: string, e: unknown): void {
  // The only signal an operator has when a live Meta pull fails in
  // production is the Vercel function log — this is deliberate.
  console.error(`[meta-live] ${connectionLabel}: ${reasonFor(e)}`, e);
}

/**
 * On-demand Meta reporting — pull-on-demand, not synced. Nothing runs in
 * the background downloading ad data; when someone opens the Meta Ads
 * page (or a client opens their share link), this hits the Graph API live
 * for exactly that account + date range. A short in-memory cache (60s)
 * keeps rapid refreshes from re-hitting Meta for the same account+range on
 * the same warm server instance.
 *
 * Trade-off, by design: nothing here is stored locally. If Meta's API is
 * down or the token has expired, the report comes back empty — there's no
 * local archive to fall back on. Historical/month-over-month comparisons
 * beyond what a single live call returns would need a nightly snapshot
 * job, which this deliberately does not do.
 */

interface CacheEntry<T> {
  expires: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.value as T;
  const value = await compute();
  cache.set(key, { expires: now + ttlMs, value });
  return value;
}

const INSIGHTS_TTL_MS = 60_000; // 60s — matches "dashboard refreshes within a minute cost zero API calls"
const HEALTH_TTL_MS = 5 * 60_000; // 5min — account health probes every account, so it's checked less often

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

export interface MetaFetchFailure {
  displayName: string;
  reason: string;
}

export interface LiveMetaReport {
  totals: AdFacts;
  trend: Array<{ date: string; spendMinor: number; revenueMinor: number }>;
  campaigns: LiveCampaign[];
  /** True if at least one connected account couldn't be reached (bad token, rate limit, etc). */
  partialFailure: boolean;
  /** Per-account reason for each failure in partialFailure — shown in the UI banner. */
  failures: MetaFetchFailure[];
}

async function resolveCreds(connection: {
  id: string;
  currencyCode: string | null;
}): Promise<ProviderCredentials | null> {
  const db = getDb();
  const secret = await db.query.integrationSecrets.findFirst({
    where: (s, { eq }) => eq(s.connectionId, connection.id),
  });
  if (secret?.encryptedPayload) {
    const parsed = JSON.parse(decryptSecret(secret.encryptedPayload)) as { accessToken: string };
    return { accessToken: parsed.accessToken, extra: { currency: connection.currencyCode ?? "INR" } };
  }
  if (env.META_USER_TOKEN) {
    return { accessToken: env.META_USER_TOKEN, extra: { currency: connection.currencyCode ?? "INR" } };
  }
  return null;
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
  const provider = createMetaProvider();

  // Paginate campaigns fully — an account can have more than one page.
  const campaignById = new Map<string, CampaignRecord>();
  let campaignCursor: string | undefined;
  do {
    const page = await provider.listCampaigns(creds, accountId, campaignCursor);
    for (const c of page.items) campaignById.set(c.externalId, c);
    campaignCursor = page.nextCursor;
  } while (campaignCursor);

  const rankings = provider.getRankings ? await provider.getRankings(creds, accountId) : {};

  // Paginate daily insights fully too.
  const dailyByCampaign = new Map<string, AdFacts[]>();
  const dailyTotals = new Map<string, { spendMinor: number; revenueMinor: number }>();
  let insightCursor: string | undefined;
  do {
    const page = await provider.getDailyInsights(creds, accountId, range, insightCursor);
    for (const row of page.items) {
      const list = dailyByCampaign.get(row.campaignExternalId) ?? [];
      list.push(row); // DailyInsightRecord extends AdFacts
      dailyByCampaign.set(row.campaignExternalId, list);

      const t = dailyTotals.get(row.date) ?? { spendMinor: 0, revenueMinor: 0 };
      t.spendMinor += row.spendMinor;
      t.revenueMinor += row.revenueMinor;
      dailyTotals.set(row.date, t);
    }
    insightCursor = page.nextCursor;
  } while (insightCursor);

  const campaigns: LiveCampaign[] = [...campaignById.values()].map((c) => {
    const rank = rankings[c.externalId];
    return {
      id: c.externalId,
      name: c.name,
      status: c.status,
      qualityRanking: c.qualityRanking ?? rank?.qualityRanking ?? null,
      engagementRateRanking: c.engagementRateRanking ?? rank?.engagementRateRanking ?? null,
      conversionRateRanking: c.conversionRateRanking ?? rank?.conversionRateRanking ?? null,
      dailyBudgetMinor: c.dailyBudgetMinor ?? null,
      facts: sumAdFacts(dailyByCampaign.get(c.externalId) ?? []),
    };
  });

  const trend = [...dailyTotals.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { campaigns, trend };
}

/**
 * Live report for every active Meta connection under a workspace, merged
 * into one totals/trend/campaigns set — mirrors what getAdDaily +
 * getCampaignsWithFacts returned from the database, but fetched fresh from
 * Meta right now instead. Returns all-zero/empty when there's nothing to
 * fetch (demo mode, or no active Meta connection yet) rather than erroring,
 * so a brand-new client workspace just shows zeros instead of crashing.
 */
export async function getLiveMetaReport(
  workspaceId: string,
  range: DateRange,
): Promise<LiveMetaReport> {
  const empty: LiveMetaReport = {
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
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "meta"), eqOp(c.status, "active")),
  });
  if (connections.length === 0) return empty;

  const failures: MetaFetchFailure[] = [];

  const perConnection = await Promise.all(
    connections.map(async (connection) => {
      const creds = await resolveCreds(connection);
      if (!creds) {
        const reason =
          "No access token available for this account — connect it in Settings or set META_USER_TOKEN.";
        failures.push({ displayName: connection.displayName, reason });
        logMetaFailure(connection.displayName, new Error(reason));
        return null;
      }
      const cacheKey = `meta:${connection.id}:${range.since}:${range.until}`;
      try {
        return await cached(cacheKey, INSIGHTS_TTL_MS, () =>
          fetchConnectionReport(creds, connection.externalAccountId, range),
        );
      } catch (e) {
        failures.push({ displayName: connection.displayName, reason: reasonFor(e) });
        logMetaFailure(connection.displayName, e);
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
  /** Sum of dailyBudgetMinor across every currently-active campaign. */
  activeDailyBudgetMinor: number;
  /** Actual spend so far today, across every active Meta connection. */
  spendTodayMinor: number;
  partialFailure: boolean;
}

/**
 * "Pacing" — are today's active campaigns on track to spend what they're
 * budgeted for? Deliberately independent of whatever date range the report
 * page has selected: pacing is always about *today*, since a daily budget
 * only means something against today's spend. Cached 60s like every other
 * live insights call.
 */
export async function getMetaPacing(workspaceId: string): Promise<PacingResult> {
  const empty: PacingResult = { activeDailyBudgetMinor: 0, spendTodayMinor: 0, partialFailure: false };
  if (isDemoMode) return empty;

  const db = getDb();
  const connections = await db.query.integrationConnections.findMany({
    where: (c, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "meta"), eqOp(c.status, "active")),
  });
  if (connections.length === 0) return empty;

  const todayIso = new Date().toISOString().slice(0, 10);
  const range: DateRange = { since: todayIso, until: todayIso };
  let partialFailure = false;

  const perConnection = await Promise.all(
    connections.map(async (connection) => {
      const creds = await resolveCreds(connection);
      if (!creds) {
        partialFailure = true;
        logMetaFailure(connection.displayName, new Error("No access token available for pacing."));
        return null;
      }
      const cacheKey = `meta-pacing:${connection.id}:${todayIso}`;
      try {
        return await cached(cacheKey, INSIGHTS_TTL_MS, () =>
          fetchConnectionReport(creds, connection.externalAccountId, range),
        );
      } catch (e) {
        partialFailure = true;
        logMetaFailure(connection.displayName, e);
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

/**
 * Cheap per-account health probe — labels each connected Meta account as
 * live (spend in the last few days), idle (connected, reachable, but no
 * recent spend), or no_access (token rejected / permissions lost). Cached
 * 5 minutes since it probes every account in parallel on each call.
 */
export async function checkMetaAccountsHealth(workspaceId: string): Promise<AccountHealthResult[]> {
  if (isDemoMode) return [];

  const db = getDb();
  const connections = await db.query.integrationConnections.findMany({
    where: (c, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "meta")),
  });
  if (connections.length === 0) return [];

  const provider = createMetaProvider();
  const since = new Date();
  since.setDate(since.getDate() - 6);
  const range: DateRange = { since: since.toISOString().slice(0, 10), until: new Date().toISOString().slice(0, 10) };

  return Promise.all(
    connections.map(async (connection) => {
      const cacheKey = `meta-health:${connection.id}`;
      const health = await cached<AccountHealth>(cacheKey, HEALTH_TTL_MS, async () => {
        const creds = await resolveCreds(connection);
        if (!creds) return "no_access";
        try {
          const page = await provider.getDailyInsights(creds, connection.externalAccountId, range);
          const spend = page.items.reduce((sum, r) => sum + r.spendMinor, 0);
          return spend > 0 ? "live" : "idle";
        } catch (e) {
          logMetaFailure(connection.displayName, e);
          return "no_access";
        }
      });
      return { connectionId: connection.id, displayName: connection.displayName, health };
    }),
  );
}
