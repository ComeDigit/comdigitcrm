import { AdsChannelPage } from "@/features/ads/channel-page";

export const metadata = { title: "Google Ads" };

export default function GoogleAdsPage() {
  return <AdsChannelPage provider="google_ads" label="Google Ads" />;
}
