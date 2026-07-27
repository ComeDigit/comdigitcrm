import "server-only";
import {
  gaqlSearch,
  assertIsoDate,
  mapGoogleAdsFacts,
  type GoogleAdsCreds,
  type GoogleAdsMetricsFields,
} from "./google-ads";
import type { AdFacts } from "@/lib/metrics/definitions";

/**
 * Deeper Google Ads reporting than the campaign-grain report in
 * google-ads-live.ts (AUDIT_REPORT.md — High: "Google Ads keyword/search-
 * term/device/location reporting missing"). Same on-demand-pull shape as
 * everything else in this app — nothing here is stored, it hits the Google
 * Ads API the moment the page is opened. Mirrors meta-breakdowns.ts's
 * structure (raw fetchers here, orchestration in
 * google-ads-breakdowns-live.ts) even though the underlying query language
 * (GAQL) is completely different from Meta's Graph API.
 *
 * Keywords and search terms are both ordered by spend and capped to the
 * top 50 directly in the GAQL query (`ORDER BY ... LIMIT 50`) rather than
 * paginating everything and slicing client-side — a busy Search campaign
 * can have thousands of either, and this Google Ads client has never been
 * exercised against a real large account (see google-ads.ts's own doc
 * comment), so an unbounded paginate-everything loop here is a real risk,
 * not just a hypothetical one.
 */

async function fetchAllPages<T>(accountId: string, query: string, creds: GoogleAdsCreds): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const { results, nextPageToken } = await gaqlSearch<T>(accountId, query, creds, pageToken);
    out.push(...results);
    pageToken = nextPageToken;
  } while (pageToken);
  return out;
}

/** Rows already capped via LIMIT in the query itself — a single page,
 *  never worth looping for. */
async function fetchOnePage<T>(accountId: string, query: string, creds: GoogleAdsCreds): Promise<T[]> {
  const { results } = await gaqlSearch<T>(accountId, query, creds);
  return results;
}

export interface GoogleAdsKeywordInsight {
  id: string;
  text: string;
  matchType: string;
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  facts: AdFacts;
}

interface GoogleAdsKeywordRow {
  adGroupCriterion: { criterionId: string; keyword?: { text?: string; matchType?: string } };
  adGroup: { id: string; name?: string };
  campaign: { id: string };
  metrics: GoogleAdsMetricsFields;
}

export async function fetchGoogleAdsKeywords(
  creds: GoogleAdsCreds,
  accountId: string,
  range: { since: string; until: string },
): Promise<GoogleAdsKeywordInsight[]> {
  const since = assertIsoDate(range.since);
  const until = assertIsoDate(range.until);
  const query =
    "SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, " +
    "ad_group_criterion.keyword.match_type, ad_group.id, ad_group.name, campaign.id, metrics.cost_micros, " +
    "metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM keyword_view " +
    `WHERE segments.date BETWEEN '${since}' AND '${until}' ORDER BY metrics.cost_micros DESC LIMIT 50`;
  const currency = creds.extra?.currency ?? "USD";
  const rows = await fetchOnePage<GoogleAdsKeywordRow>(accountId, query, creds);
  return rows.map((r) => ({
    id: `${r.adGroup.id}:${r.adGroupCriterion.criterionId}`,
    text: r.adGroupCriterion.keyword?.text ?? "(unknown)",
    matchType: r.adGroupCriterion.keyword?.matchType ?? "UNKNOWN",
    adGroupId: r.adGroup.id,
    adGroupName: r.adGroup.name ?? r.adGroup.id,
    campaignId: r.campaign.id,
    facts: mapGoogleAdsFacts(r.metrics, currency),
  }));
}

export interface GoogleAdsSearchTermInsight {
  id: string;
  searchTerm: string;
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  facts: AdFacts;
}

interface GoogleAdsSearchTermRow {
  searchTermView: { searchTerm: string };
  adGroup: { id: string; name?: string };
  campaign: { id: string };
  metrics: GoogleAdsMetricsFields;
}

/**
 * Search terms are the actual queries people typed that triggered an ad —
 * distinct from keywords (what the advertiser bid on). The same term can
 * appear once per ad group it matched under, so rows are kept ad-group-
 * scoped rather than collapsed into one row per term, matching how Google
 * Ads' own UI reports this by default.
 */
export async function fetchGoogleAdsSearchTerms(
  creds: GoogleAdsCreds,
  accountId: string,
  range: { since: string; until: string },
): Promise<GoogleAdsSearchTermInsight[]> {
  const since = assertIsoDate(range.since);
  const until = assertIsoDate(range.until);
  const query =
    "SELECT search_term_view.search_term, ad_group.id, ad_group.name, campaign.id, metrics.cost_micros, " +
    "metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM search_term_view " +
    `WHERE segments.date BETWEEN '${since}' AND '${until}' ORDER BY metrics.cost_micros DESC LIMIT 50`;
  const currency = creds.extra?.currency ?? "USD";
  const rows = await fetchOnePage<GoogleAdsSearchTermRow>(accountId, query, creds);
  return rows.map((r, i) => ({
    id: `${r.adGroup.id}:${i}`,
    searchTerm: r.searchTermView.searchTerm,
    adGroupId: r.adGroup.id,
    adGroupName: r.adGroup.name ?? r.adGroup.id,
    campaignId: r.campaign.id,
    facts: mapGoogleAdsFacts(r.metrics, currency),
  }));
}

export interface GoogleAdsDeviceInsight {
  device: string;
  facts: AdFacts;
}

interface GoogleAdsDeviceRow {
  segments: { device: string };
  metrics: GoogleAdsMetricsFields;
}

/**
 * One row per device type (MOBILE/DESKTOP/TABLET/CONNECTED_TV/OTHER),
 * aggregated across every campaign for the whole range — selecting only
 * segments.device (no campaign/date fields) makes GAQL aggregate
 * everything else away, the same way Meta's account-level breakdowns do.
 * Small, fixed cardinality (~5 values) — no LIMIT needed.
 */
export async function fetchGoogleAdsDeviceBreakdown(
  creds: GoogleAdsCreds,
  accountId: string,
  range: { since: string; until: string },
): Promise<GoogleAdsDeviceInsight[]> {
  const since = assertIsoDate(range.since);
  const until = assertIsoDate(range.until);
  const query =
    "SELECT segments.device, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, " +
    `metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  const currency = creds.extra?.currency ?? "USD";
  const rows = await fetchAllPages<GoogleAdsDeviceRow>(accountId, query, creds);
  return rows
    .map((r) => ({ device: r.segments.device, facts: mapGoogleAdsFacts(r.metrics, currency) }))
    .sort((a, b) => b.facts.spendMinor - a.facts.spendMinor);
}

/**
 * Country-level Google Ads geo target criterion IDs → ISO 3166-1 alpha-2
 * codes. Google publishes the full mapping (thousands of rows, city/region
 * granularity included) as a downloadable reference from the Google Ads
 * API geo targets docs (developers.google.com/google-ads/api/data/
 * geotargets); fetching and parsing that full file is a reasonable future
 * enhancement, not done here.
 *
 * This is deliberately a SMALL, hand-verified subset — cross-checked
 * against Google's own published geo targets reference rather than
 * guessed — covering the markets most agency clients actually run ads in.
 * A wrong numeric-ID-to-country mapping would silently mislabel a
 * client's location data with nothing to catch it (unlike a code bug,
 * there's no typecheck/test that can verify a hardcoded ID is correct),
 * so this table only includes IDs actually confirmed against Google's
 * documentation — it does NOT attempt to cover every country. Anything
 * not in this table still shows up in the report labeled by its raw
 * criterion ID rather than a guessed country (see
 * fetchGoogleAdsLocationBreakdown below) — nothing is silently dropped,
 * nothing is silently mislabeled.
 */
export const GOOGLE_COUNTRY_CRITERIA: Record<string, string> = {
  "2840": "US",
  "2826": "GB",
  "2124": "CA",
  "2036": "AU",
  "2356": "IN",
  "2276": "DE",
  "2250": "FR",
  "2392": "JP",
  "2076": "BR",
  "2484": "MX",
};

export interface GoogleAdsLocationInsight {
  countryCriterionId: string;
  /** ISO 3166-1 alpha-2 code when the criterion ID is in our verified
   *  table above; null otherwise (UI falls back to the raw ID). */
  countryCode: string | null;
  facts: AdFacts;
}

interface GoogleAdsGeoRow {
  geographicView: { countryCriterionId: string };
  metrics: GoogleAdsMetricsFields;
}

/**
 * Performance by the searcher's physical country (geographic_view is
 * always country-grain — city/region-level performance lives in the
 * separate user_location_view resource, not fetched here). Capped to the
 * top 25 by spend, same as Meta's country breakdown.
 */
export async function fetchGoogleAdsLocationBreakdown(
  creds: GoogleAdsCreds,
  accountId: string,
  range: { since: string; until: string },
): Promise<GoogleAdsLocationInsight[]> {
  const since = assertIsoDate(range.since);
  const until = assertIsoDate(range.until);
  const query =
    "SELECT geographic_view.country_criterion_id, metrics.cost_micros, metrics.impressions, metrics.clicks, " +
    "metrics.conversions, metrics.conversions_value FROM geographic_view " +
    `WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  const currency = creds.extra?.currency ?? "USD";
  const rows = await fetchAllPages<GoogleAdsGeoRow>(accountId, query, creds);
  return rows
    .map((r) => ({
      countryCriterionId: r.geographicView.countryCriterionId,
      countryCode: GOOGLE_COUNTRY_CRITERIA[r.geographicView.countryCriterionId] ?? null,
      facts: mapGoogleAdsFacts(r.metrics, currency),
    }))
    .sort((a, b) => b.facts.spendMinor - a.facts.spendMinor)
    .slice(0, 25);
}
