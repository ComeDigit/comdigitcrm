import { DateRangePicker } from "@/components/charts/date-range-picker";
import { OverviewReport } from "@/features/overview/report";
import { resolveDateRange } from "@/features/metrics/queries";
import { requireClientSession } from "@/lib/auth/client-session";
import { getWorkspaceName } from "@/lib/workspace";

export const metadata = { title: "Overview" };

export default async function ClientOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; since?: string; until?: string }>;
}) {
  const session = await requireClientSession();
  const workspaceName = await getWorkspaceName(session.workspaceId);
  const { range, preset } = resolveDateRange(await searchParams);

  return (
    <main className="space-y-6 px-6 py-6">
      <DateRangePicker preset={preset} range={range} />
      <OverviewReport
        workspaceId={session.workspaceId}
        workspaceName={workspaceName}
        range={range}
        preset={preset}
      />
    </main>
  );
}
