import { AdsChannelPage } from "@/features/ads/channel-page";

export const metadata = { title: "Meta Ads" };

export default function MetaAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; since?: string; until?: string }>;
}) {
  return <AdsChannelPage provider="meta" label="Meta Ads" searchParams={searchParams} />;
}
