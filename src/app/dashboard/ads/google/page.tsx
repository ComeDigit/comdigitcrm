import { AdsChannelPage } from "@/features/ads/channel-page";

export const metadata = { title: "Google Ads" };

export default function GoogleAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; since?: string; until?: string }>;
}) {
  return <AdsChannelPage provider="google_ads" label="Google Ads" searchParams={searchParams} />;
}
