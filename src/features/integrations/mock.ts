import {
  demoAdInsights,
  demoCampaigns,
  type DemoProvider,
} from "@/features/demo-data/generator";
import type {
  AdsProvider,
  DailyInsightRecord,
  PageResult,
  ProviderCredentials,
  ProviderKey,
  CampaignRecord,
} from "./types";

/**
 * Deterministic mock provider — same interface as real providers, powered
 * by the seeded demo generator. Used when a connection has no real
 * credentials (demo mode) and by integration tests as fixtures.
 */
export function createMockAdsProvider(key: DemoProvider): AdsProvider {
  return {
    key: key as ProviderKey,

    async listCampaigns(
      _creds: ProviderCredentials,
      accountId: string,
    ): Promise<PageResult<CampaignRecord>> {
      const items = demoCampaigns(accountId, key).map((c) => ({
        externalId: c.id,
        name: c.name,
        status: c.status,
        currencyCode: "INR",
        qualityRanking: c.qualityRanking,
        engagementRateRanking: c.engagementRateRanking,
        conversionRateRanking: c.conversionRateRanking,
      }));
      return { items };
    },

    async getDailyInsights(
      _creds: ProviderCredentials,
      accountId: string,
      range: { since: string; until: string },
    ): Promise<PageResult<DailyInsightRecord>> {
      const campaigns = demoCampaigns(accountId, key);
      const daily = demoAdInsights(accountId, key, 60).filter(
        (r) => r.date >= range.since && r.date <= range.until,
      );
      // Attribute each day's totals to the first active campaign — enough
      // fidelity for demo dashboards; real providers return per-campaign rows.
      const target = campaigns[0]?.id ?? `${key}-c0`;
      const items = daily.map((d) => ({
        campaignExternalId: target,
        date: d.date,
        currencyCode: "INR",
        spendMinor: d.spendMinor,
        revenueMinor: d.revenueMinor,
        impressions: d.impressions,
        clicks: d.clicks,
        purchases: d.purchases,
        reach: d.reach,
        videoViews3s: d.videoViews3s,
        videoPlays: d.videoPlays,
        inlineLinkClicks: d.inlineLinkClicks,
        outboundClicks: d.outboundClicks,
        uniqueClicks: d.uniqueClicks,
        landingPageViews: d.landingPageViews,
        pageEngagements: d.pageEngagements,
        videoThruplays: d.videoThruplays,
        videoP50: d.videoP50,
        videoP75: d.videoP75,
        videoP100: d.videoP100,
        viewContent: d.viewContent,
        addToCart: d.addToCart,
        initiateCheckout: d.initiateCheckout,
        addPaymentInfo: d.addPaymentInfo,
        leads: d.leads,
      }));
      return { items };
    },
  };
}
