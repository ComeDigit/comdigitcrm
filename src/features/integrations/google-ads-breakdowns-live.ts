import "server-only";
import { getDb } from "@/lib/db";
import { isDemoMode } from "@/lib/env";
import { resolveCreds, cached, reasonFor, logGoogleAdsFailure, INSIGHTS_TTL_MS } from "./google-ads-live";
import {
  fetchGoogleAdsKeywords,
  fetchGoogleAdsSearchTerms,
  fetchGoogleAdsDeviceBreakdown,
  fetchGoogleAdsLocationBreakdown,
  type GoogleAdsKeywordInsight,
  type GoogleAdsSearchTermInsight,
  type GoogleAdsDeviceInsight,
  type GoogleAdsLocationInsight,
} from "./google-ads-breakdowns";
import { sumAdFacts, type AdFacts } from "@/lib/metrics/definitions";
import type { DateRange } from "@/features/metrics/queries";
import type { ResolvedGoogleAdsCreds } from "./google-ads-live";
import type { GoogleAdsFetchFailure } from "./google-ads-live";

/**
 * On-demand orchestration for the deeper Google Ads reports
 * (google-ads-breakdowns.ts) — same shape as getLiveGoogleAdsReport in
 * google-ads-live.ts: resolve every active Google Ads connection under the
 * workspace, pull each live (cached 60s per connection+range), merge, and
 * surface partial failures. Mirrors meta-breakdowns-live.ts's structure.
 *
 * Keywords/search terms are flat-concatenated across connections (already
 * unique to their own ad account, same precedent as campaigns). Device and
 * location rows are SUMMED across connections by their segment key, same
 * precedent as meta-live.ts's daily trend and meta-breakdowns-live.ts's
 * audience merge.
 */

interface Failing {
  failures: GoogleAdsFetchFailure[];
}

async function forEachConnection<T>(
  workspaceId: string,
  fetchOne: (creds: ResolvedGoogleAdsCreds, accountId: string) => Promise<T>,
): Promise<{ results: T[] } & Failing> {
  if (isDemoMode) return { results: [], failures: [] };

  const db = getDb();
  const connections = await db.query.integrationConnections.findMany({
    where: (c, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "google_ads"), eqOp(c.status, "active")),
  });
  if (connections.length === 0) return { results: [], failures: [] };

  const failures: GoogleAdsFetchFailure[] = [];
  const perConnection = await Promise.all(
    connections.map(async (connection) => {
      // resolveCreds itself can throw here (it refreshes the access token
      // over the network) — unlike Meta's version, it can't be null-checked
      // outside a try/catch. Mirrors getLiveGoogleAdsReport's own structure
      // in google-ads-live.ts.
      try {
        const creds = await resolveCreds(connection);
        if (!creds) {
          const reason =
            "No refresh token available for this account — connect it in Settings or set GOOGLE_ADS_REFRESH_TOKEN.";
          failures.push({ displayName: connection.displayName, reason });
          logGoogleAdsFailure(connection.displayName, new Error(reason));
          return null;
        }
        return await fetchOne(creds, connection.externalAccountId);
      } catch (e) {
        failures.push({ displayName: connection.displayName, reason: reasonFor(e) });
        logGoogleAdsFailure(connection.displayName, e);
        return null;
      }
    }),
  );
  // Cast (not a type-predicate filter): for a fully generic, unconstrained
  // T, TS can't prove Awaited<T> is identical to T — same issue as
  // meta-breakdowns-live.ts's forEachConnection.
  return { results: perConnection.filter((r) => r !== null) as T[], failures };
}

export interface LiveGoogleAdsKeywords extends Failing {
  keywords: GoogleAdsKeywordInsight[];
  partialFailure: boolean;
}

export async function getLiveGoogleAdsKeywords(workspaceId: string, range: DateRange): Promise<LiveGoogleAdsKeywords> {
  const { results, failures } = await forEachConnection(workspaceId, (creds, accountId) =>
    cached(`gads-keywords:${workspaceId}:${accountId}:${range.since}:${range.until}`, INSIGHTS_TTL_MS, () =>
      fetchGoogleAdsKeywords(creds, accountId, range),
    ),
  );
  return { keywords: results.flat(), partialFailure: failures.length > 0, failures };
}

export interface LiveGoogleAdsSearchTerms extends Failing {
  searchTerms: GoogleAdsSearchTermInsight[];
  partialFailure: boolean;
}

export async function getLiveGoogleAdsSearchTerms(
  workspaceId: string,
  range: DateRange,
): Promise<LiveGoogleAdsSearchTerms> {
  const { results, failures } = await forEachConnection(workspaceId, (creds, accountId) =>
    cached(`gads-searchterms:${workspaceId}:${accountId}:${range.since}:${range.until}`, INSIGHTS_TTL_MS, () =>
      fetchGoogleAdsSearchTerms(creds, accountId, range),
    ),
  );
  return { searchTerms: results.flat(), partialFailure: failures.length > 0, failures };
}

export interface LiveGoogleAdsAudience extends Failing {
  byDevice: GoogleAdsDeviceInsight[];
  byLocation: GoogleAdsLocationInsight[];
  partialFailure: boolean;
}

/** "Audience" here mirrors getLiveMetaAudience's grouping — device and
 *  location are both "who/where" dimensions, fetched and merged together
 *  in one call since they're always shown together on the report page. */
export async function getLiveGoogleAdsAudience(workspaceId: string, range: DateRange): Promise<LiveGoogleAdsAudience> {
  const [deviceResult, locationResult] = await Promise.all([
    forEachConnection(workspaceId, (creds, accountId) =>
      cached(`gads-device:${workspaceId}:${accountId}:${range.since}:${range.until}`, INSIGHTS_TTL_MS, () =>
        fetchGoogleAdsDeviceBreakdown(creds, accountId, range),
      ),
    ),
    forEachConnection(workspaceId, (creds, accountId) =>
      cached(`gads-location:${workspaceId}:${accountId}:${range.since}:${range.until}`, INSIGHTS_TTL_MS, () =>
        fetchGoogleAdsLocationBreakdown(creds, accountId, range),
      ),
    ),
  ]);

  const byDeviceMap = new Map<string, AdFacts[]>();
  for (const rows of deviceResult.results) {
    for (const row of rows) {
      const list = byDeviceMap.get(row.device) ?? [];
      list.push(row.facts);
      byDeviceMap.set(row.device, list);
    }
  }
  const byDevice = [...byDeviceMap.entries()]
    .map(([device, facts]) => ({ device, facts: sumAdFacts(facts) }))
    .sort((a, b) => b.facts.spendMinor - a.facts.spendMinor);

  const byLocationMap = new Map<
    string,
    { countryCriterionId: string; countryCode: string | null; facts: AdFacts[] }
  >();
  for (const rows of locationResult.results) {
    for (const row of rows) {
      const entry = byLocationMap.get(row.countryCriterionId) ?? {
        countryCriterionId: row.countryCriterionId,
        countryCode: row.countryCode,
        facts: [],
      };
      entry.facts.push(row.facts);
      byLocationMap.set(row.countryCriterionId, entry);
    }
  }
  const byLocation = [...byLocationMap.values()]
    .map((e) => ({ countryCriterionId: e.countryCriterionId, countryCode: e.countryCode, facts: sumAdFacts(e.facts) }))
    .sort((a, b) => b.facts.spendMinor - a.facts.spendMinor)
    .slice(0, 25);

  // Same connections/credentials power both fetches, so a bad token fails
  // both at once — de-duped by display name so the banner doesn't list the
  // same account twice.
  const failures = [...deviceResult.failures];
  for (const f of locationResult.failures) {
    if (!failures.some((existing) => existing.displayName === f.displayName)) failures.push(f);
  }

  return { byDevice, byLocation, partialFailure: failures.length > 0, failures };
}
