import { AdsReport } from "@/features/ads/channel-page";
import { resolveDateRange } from "@/features/metrics/queries";
import { requireClientSession } from "@/lib/auth/client-session";

export const metadata = { title: "Meta Ads" };

export default async function ClientMetaAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; since?: string; until?: string }>;
}) {
  const session = await requireClientSession();
  const { range, preset } = resolveDateRange(await searchParams);

  return (
    <AdsReport
      workspaceId={session.workspaceId}
      provider="meta"
      label="Meta Ads"
      range={range}
      preset={preset}
    />
  );
}
