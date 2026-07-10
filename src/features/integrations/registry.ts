import "server-only";
import { isDemoMode } from "@/lib/env";
import { createMockAdsProvider } from "./mock";
import type { AdsProvider, ProviderKey } from "./types";

/**
 * Provider registry: the ONLY place sync jobs resolve a provider client.
 * Real implementations land per-integration-phase (Phase 7 Meta, Phase 8
 * Google Ads, Phase 9 TikTok) behind the same AdsProvider contract —
 * nothing upstream changes when they do. Until real credentials exist,
 * the deterministic mock serves every environment.
 */

const mockable: ProviderKey[] = ["meta", "google_ads", "tiktok"];

export function getAdsProvider(key: ProviderKey): AdsProvider {
  if (key === "meta" || key === "google_ads" || key === "tiktok") {
    // TODO(Phase 7-9): return real client when the connection has live
    // credentials. Shape: createMetaProvider(env) satisfying AdsProvider.
    return createMockAdsProvider(key);
  }
  throw new Error(
    `Provider ${key} is not an ads provider (mockable: ${mockable.join(", ")})`,
  );
}

export function isLiveProviderAvailable(): boolean {
  return !isDemoMode;
}
