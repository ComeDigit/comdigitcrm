import { Topbar } from "@/components/shell/topbar";
import { DateRangePicker } from "@/components/charts/date-range-picker";
import { ShopifyReport } from "@/features/shopify/report";
import { resolveDateRange } from "@/features/metrics/queries";
import { getActiveWorkspaceId, getWorkspaceName } from "@/lib/workspace";

export const metadata = { title: "Shopify" };

export default async function ShopifyPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; since?: string; until?: string }>;
}) {
  const workspaceId = await getActiveWorkspaceId();
  const { range, preset } = resolveDateRange(await searchParams);
  const workspaceName = await getWorkspaceName(workspaceId);

  return (
    <>
      <Topbar title={`Shopify — ${workspaceName}`} />
      <main className="space-y-6 px-6 py-6">
        <DateRangePicker preset={preset} range={range} />
        <ShopifyReport workspaceId={workspaceId} range={range} preset={preset} />
      </main>
    </>
  );
}
