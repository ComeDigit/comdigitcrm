import "server-only";
import { getDb } from "@/lib/db";
import { isDemoMode } from "@/lib/env";
import { resolveCreds, cached, reasonFor, logMetaFailure, INSIGHTS_TTL_MS } from "./meta-live";
import {
  fetchMetaAdSetInsights,
  fetchMetaAdInsights,
  fetchMetaAgeGenderBreakdown,
  fetchMetaCountryBreakdown,
  type MetaAdSetInsight,
  type MetaAdInsight,
  type MetaAgeGenderInsight,
  type MetaCountryInsight,
} from "./meta-breakdowns";
import { sumAdFacts } from "@/lib/metrics/definitions";
import type { DateRange } from "@/features/metrics/queries";
import type { MetaFetchFailure } from "./meta-live";

/**
 * On-demand orchestration for the deeper Meta reports (meta-breakdowns.ts)
 * — same shape as getLiveMetaReport in meta-live.ts: resolve every active
 * Meta connection under the workspace, pull each live (cached 60s per
 * connection+range), merge, and surface partial failures instead of
 * silently dropping an unreachable account's numbers.
 *
 * Ad sets/ads are flat-concatenated across connections (each entity's id is
 * already unique to its own ad account — same precedent as campaigns in
 * meta-live.ts). Age/gender and country rows are SUMMED across connections
 * by their segment key — same precedent as meta-live.ts's daily trend,
 * which blends multiple ad accounts into one combined series.
 */

interface Failing {
  failures: MetaFetchFailure[];
}

async function forEachConnection<T>(
  workspaceId: string,
  fetchOne: (accessToken: string, accountId: string, currency: string) => Promise<T>,
): Promise<{ results: T[] } & Failing> {
  if (isDemoMode) return { results: [], failures: [] };

  const db = getDb();
  const connections = await db.query.integrationConnections.findMany({
    where: (c, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "meta"), eqOp(c.status, "active")),
  });
  if (connections.length === 0) return { results: [], failures: [] };

  const failures: MetaFetchFailure[] = [];
  const perConnection = await Promise.all(
    connections.map(async (connection) => {
      const creds = await resolveCreds(connection);
      if (!creds) {
        const reason = "No access token available for this account — connect it in Settings or set META_USER_TOKEN.";
        failures.push({ displayName: connection.displayName, reason });
        logMetaFailure(connection.displayName, new Error(reason));
        return null;
      }
      try {
        return await fetchOne(creds.accessToken, connection.externalAccountId, creds.extra?.currency ?? "INR");
      } catch (e) {
        failures.push({ displayName: connection.displayName, reason: reasonFor(e) });
        logMetaFailure(connection.displayName, e);
        return null;
      }
    }),
  );
  // Cast (not a type-predicate filter): for a fully generic, unconstrained
  // T, TS can't prove Awaited<T> is identical to T, so `r is T` fails to
  // type-check here even though every non-null branch above is literally
  // the T that fetchOne resolved to.
  return { results: perConnection.filter((r) => r !== null) as T[], failures };
}

export interface LiveMetaAdSets extends Failing {
  adSets: MetaAdSetInsight[];
  partialFailure: boolean;
}

export async function getLiveMetaAdSets(workspaceId: string, range: DateRange): Promise<LiveMetaAdSets> {
  const { results, failures } = await forEachConnection(workspaceId, (token, accountId, currency) =>
    cached(`meta-adsets:${workspaceId}:${accountId}:${range.since}:${range.until}`, INSIGHTS_TTL_MS, () =>
      fetchMetaAdSetInsights(token, accountId, range, currency),
    ),
  );
  return { adSets: results.flat(), partialFailure: failures.length > 0, failures };
}

export interface LiveMetaAds extends Failing {
  ads: MetaAdInsight[];
  partialFailure: boolean;
}

export async function getLiveMetaAds(workspaceId: string, range: DateRange): Promise<LiveMetaAds> {
  const { results, failures } = await forEachConnection(workspaceId, (token, accountId, currency) =>
    cached(`meta-ads:${workspaceId}:${accountId}:${range.since}:${range.until}`, INSIGHTS_TTL_MS, () =>
      fetchMetaAdInsights(token, accountId, range, currency),
    ),
  );
  return { ads: results.flat(), partialFailure: failures.length > 0, failures };
}

export interface LiveMetaAudience extends Failing {
  byAgeGender: MetaAgeGenderInsight[];
  byCountry: MetaCountryInsight[];
  partialFailure: boolean;
}

export async function getLiveMetaAudience(workspaceId: string, range: DateRange): Promise<LiveMetaAudience> {
  const [ageGenderResult, countryResult] = await Promise.all([
    forEachConnection(workspaceId, (token, accountId, currency) =>
      cached(`meta-age-gender:${workspaceId}:${accountId}:${range.since}:${range.until}`, INSIGHTS_TTL_MS, () =>
        fetchMetaAgeGenderBreakdown(token, accountId, range, currency),
      ),
    ),
    forEachConnection(workspaceId, (token, accountId, currency) =>
      cached(`meta-country:${workspaceId}:${accountId}:${range.since}:${range.until}`, INSIGHTS_TTL_MS, () =>
        fetchMetaCountryBreakdown(token, accountId, range, currency),
      ),
    ),
  ]);

  const byAgeGenderMap = new Map<string, { age: string; gender: string; facts: MetaAgeGenderInsight["facts"][] }>();
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

  const byCountryMap = new Map<string, MetaCountryInsight["facts"][]>();
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

  // Current + previous fetches use the same connections/credentials, so a
  // failure on one breakdown call almost always means the other failed too
  // — de-duped by display name so the banner doesn't list the same account
  // twice (once per breakdown type).
  const failures = [...ageGenderResult.failures];
  for (const f of countryResult.failures) {
    if (!failures.some((existing) => existing.displayName === f.displayName)) failures.push(f);
  }

  return { byAgeGender, byCountry, partialFailure: failures.length > 0, failures };
}
