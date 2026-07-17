import { AdsChannelPage } from "@/features/ads/channel-page";

export const metadata = { title: "TikTok Ads" };

export default function TikTokAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; since?: string; until?: string }>;
}) {
  return <AdsChannelPage provider="tiktok" label="TikTok Ads" searchParams={searchParams} />;
}
