import { AdsReport, resolveCampaignTableParams } from "@/features/ads/channel-page";
import { resolveDateRange } from "@/features/metrics/queries";
import { requireClientSession } from "@/lib/auth/client-session";

export const metadata = { title: "Meta Ads" };

export default async function ClientMetaAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; since?: string; until?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const session = await requireClientSession();
  const resolvedParams = await searchParams;
  const { range, preset } = resolveDateRange(resolvedParams);
  const { sortKey, sortDir, page } = resolveCampaignTableParams(resolvedParams);

  return (
    <AdsReport
      workspaceId={session.workspaceId}
      provider="meta"
      label="Meta Ads"
      range={range}
      preset={preset}
      sortKey={sortKey}
      sortDir={sortDir}
      page={page}
    />
  );
}
