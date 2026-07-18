import { DateRangePicker } from "@/components/charts/date-range-picker";
import { ShopifyReport } from "@/features/shopify/report";
import { resolveDateRange } from "@/features/metrics/queries";
import { requireClientSession } from "@/lib/auth/client-session";

export const metadata = { title: "Shopify" };

export default async function ClientShopifyPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; since?: string; until?: string }>;
}) {
  const session = await requireClientSession();
  const { range, preset } = resolveDateRange(await searchParams);

  return (
    <main className="space-y-6 px-6 py-6">
      <DateRangePicker preset={preset} range={range} />
      <ShopifyReport workspaceId={session.workspaceId} range={range} preset={preset} />
    </main>
  );
}
