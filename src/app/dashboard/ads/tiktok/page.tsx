import { AdsChannelPage } from "@/features/ads/channel-page";

export const metadata = { title: "TikTok Ads" };

export default function TikTokAdsPage() {
  return <AdsChannelPage provider="tiktok" label="TikTok Ads" />;
}
