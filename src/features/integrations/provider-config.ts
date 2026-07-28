import { env } from "@/lib/env";

/**
 * Shared provider display config for the Integrations UI. Both the global
 * Settings page (every client's connections in one list) and the per-client
 * detail page (one client's connections only) read this SAME array, so a
 * label/phase/env-var change can never drift between the two views —
 * same reasoning as the mapTikTokFacts/TIKTOK_METRICS shared-helper split
 * in features/integrations/tiktok.ts.
 */
export interface ProviderConfig {
  key: string;
  label: string;
  phase: string;
  envVar?: string;
}

export const PROVIDERS: ProviderConfig[] = [
  { key: "shopify", label: "Shopify", phase: "Phase 6" },
  { key: "meta", label: "Meta Ads", phase: "Phase 7", envVar: "META_APP_ID" },
  { key: "google_ads", label: "Google Ads", phase: "Phase 8", envVar: "GOOGLE_ADS_CLIENT_ID" },
  { key: "tiktok", label: "TikTok Ads", phase: "Phase 9", envVar: "TIKTOK_APP_ID" },
  { key: "ga4", label: "Google Analytics 4", phase: "Phase 10" },
  { key: "search_console", label: "Search Console", phase: "Phase 10" },
];

export interface ProviderAvailability {
  metaConfigured: boolean;
  shopifyOAuthConfigured: boolean;
  agencyTokenConfigured: boolean;
  googleAdsConfigured: boolean;
  googleAdsAgencyConfigured: boolean;
  tiktokConfigured: boolean;
}

/** Same six env-var checks Settings and the per-client detail page both
 *  need to decide which Connect buttons/forms to show — one place so the
 *  two views can never disagree about whether a provider is configured. */
export function getProviderAvailability(): ProviderAvailability {
  return {
    metaConfigured: Boolean(process.env.META_APP_ID),
    shopifyOAuthConfigured: Boolean(
      process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET,
    ),
    agencyTokenConfigured: Boolean(env.META_USER_TOKEN),
    googleAdsConfigured: Boolean(process.env.GOOGLE_ADS_CLIENT_ID),
    googleAdsAgencyConfigured: Boolean(env.GOOGLE_ADS_REFRESH_TOKEN),
    // Both vars are required: unlike Meta's manual-token form (which only
    // needs the pasted token itself), TikTok's advertiser lookup needs the
    // app id/secret alongside any pasted token — see previewTikTokAccessToken.
    tiktokConfigured: Boolean(process.env.TIKTOK_APP_ID && process.env.TIKTOK_APP_SECRET),
  };
}
