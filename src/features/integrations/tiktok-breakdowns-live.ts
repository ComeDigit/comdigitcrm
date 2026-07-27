import "server-only";
import { getDb } from "@/lib/db";
import { isDemoMode } from "@/lib/env";
import { cached, reasonFor, logTikTokFailure, withCreds, INSIGHTS_TTL_MS } from "./tiktok-live";
import {
  fetchTikTokAdInsights,
  fetchTikTokAgeGenderBreakdown,
  fetchTikTokCountryBreakdown,
  type TikTokAdInsight,
  type TikTokAgeGenderInsight,
  type TikTokCountryInsight,
} from "./tiktok-breakdowns";
import { sumAdFacts, type AdFacts } from "@/lib/metrics/definitions";
import type { DateRange } from "@/features/metrics/queries";
import type { ProviderCredentials } from "./types";
import type { TikTokFetchFailure } from "./tiktok-live";

/**
 * On-demand orchestration for the deeper TikTok reports
 * (tiktok-breakdowns.ts) — same shape as getLiveTikTokReport in
 * tiktok-live.ts: resolve every active TikTok connection under the
 * workspace, pull each live (cached 60s per connection+range), merge, and
 * surface partial failures instead of silently dropping an unreachable
 * account's numbers. Mirrors meta-breakdowns-live.ts's structure.
 *
 * forEachConnection here is simpler than Meta's version: TikTok's
 * withCreds (tiktok-live.ts) already unifies "no token on file" and "the
 * fetch itself failed" into a single throw-and-retry-once path, so there's
 * no separate null-creds branch to special-case the way Meta's
 * resolveCreds requires — one try/catch per connection covers both, same
 * as getLiveTikTokReport's own per-connection loop.
 *
 * Ads are flat-concatenated across connections (each ad_id is already
 * unique to its own ad account, same precedent as campaigns in
 * tiktok-live.ts). Age/gender and country rows are SUMMED across
 * connections by their segment key, same precedent as
 * meta-breakdowns-live.ts's audience merge.
 */

interface Failing {
  failures: TikTokFetchFailure[];
}

async function forEachConnection<T>(
  workspaceId: string,
  fetchOne: (creds: ProviderCredentials, accountId: string) => Promise<T>,
): Promise<{ results: T[] } & Failing> {
  if (isDemoMode) return { results: [], failures: [] };

  const db = getDb();
  const connections = await db.query.integrationConnections.findMany({
    where: (c, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "tiktok"), eqOp(c.status, "active")),
  });
  if (connections.length === 0) return { results: [], failures: [] };

  const failures: TikTokFetchFailure[] = [];
  const perConnection = await Promise.all(
    connections.map(async (connection) => {
      try {
        return await withCreds(connection, (creds) => fetchOne(creds, connection.externalAccountId));
      } catch (e) {
        failures.push({ displayName: connection.displayName, reason: reasonFor(e) });
        logTikTokFailure(connection.displayName, e);
        return null;
      }
    }),
  );
  // Cast (not a type-predicate filter): for a fully generic, unconstrained
  // T, TS can't prove Awaited<T> is identical to T — same issue as
  // meta-breakdowns-live.ts's forEachConnection.
  return { results: perConnection.filter((r) => r !== null) as T[], failures };
}

export interface LiveTikTokAds extends Failing {
  ads: TikTokAdInsight[];
  partialFailure: boolean;
}

export async function getLiveTikTokAds(workspaceId: string, range: DateRange): Promise<LiveTikTokAds> {
  const { results, failures } = await forEachConnection(workspaceId, (creds, accountId) =>
    cached(`tiktok-ads:${workspaceId}:${accountId}:${range.since}:${range.until}`, INSIGHTS_TTL_MS, () =>
      fetchTikTokAdInsights(creds.accessToken, accountId, range, creds.extra?.currency ?? "USD"),
    ),
  );
  return { ads: results.flat(), partialFailure: failures.length > 0, failures };
}

export interface LiveTikTokAudience extends Failing {
  byAgeGender: TikTokAgeGenderInsight[];
  byCountry: TikTokCountryInsight[];
  partialFailure: boolean;
}

export async function getLiveTikTokAudience(workspaceId: string, range: DateRange): Promise<LiveTikTokAudience> {
  const [ageGenderResult, countryResult] = await Promise.all([
    forEachConnection(workspaceId, (creds, accountId) =>
      cached(`tiktok-age-gender:${workspaceId}:${accountId}:${range.since}:${range.until}`, INSIGHTS_TTL_MS, () =>
        fetchTikTokAgeGenderBreakdown(creds.accessToken, accountId, range, creds.extra?.currency ?? "USD"),
      ),
    ),
    forEachConnection(workspaceId, (creds, accountId) =>
      cached(`tiktok-country:${workspaceId}:${accountId}:${range.since}:${range.until}`, INSIGHTS_TTL_MS, () =>
        fetchTikTokCountryBreakdown(creds.accessToken, accountId, range, creds.extra?.currency ?? "USD"),
      ),
    ),
  ]);

  const byAgeGenderMap = new Map<string, { age: string; gender: string; facts: AdFacts[] }>();
  for (const rows of ageGenderResult.results) {
    for (const row of rows) {
      const key = `${row.age}|${row.gender}`;
      const entry = byAgeGenderMap.get(key) ?? { age: row.age, gender: row.gender, facts: [] };
      entry.facts.push(row.facts);
      byAgeGenderMap.set(key, entry);
    }
  }
  const byAgeGender = [...byAgeGenderMap.values()]
    .map((e) => ({ age: e.age, gender: e.gender, facts: sumAdFacts(e.facts) }))
    .sort((a, b) => b.facts.spendMinor - a.facts.spendMinor);

  const byCountryMap = new Map<string, AdFacts[]>();
  for (const rows of countryResult.results) {
    for (const row of rows) {
      const list = byCountryMap.get(row.country) ?? [];
      list.push(row.facts);
      byCountryMap.set(row.country, list);
    }
  }
  const byCountry = [...byCountryMap.entries()]
    .map(([country, facts]) => ({ country, facts: sumAdFacts(facts) }))
    .sort((a, b) => b.facts.spendMinor - a.facts.spendMinor)
    .slice(0, 25);

  // Same connections/credentials power both fetches, so a bad token fails
  // both at once — de-duped by display name so the banner doesn't list the
  // same account twice.
  const failures = [...ageGenderResult.failures];
  for (const f of countryResult.failures) {
    if (!failures.some((existing) => existing.displayName === f.displayName)) failures.push(f);
  }

  return { byAgeGender, byCountry, partialFailure: failures.length > 0, failures };
}
