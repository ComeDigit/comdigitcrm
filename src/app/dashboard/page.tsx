import { Topbar } from "@/components/shell/topbar";
import { DateRangePicker } from "@/components/charts/date-range-picker";
import { OverviewReport } from "@/features/overview/report";
import { resolveDateRange } from "@/features/metrics/queries";
import { getActiveWorkspaceId, getWorkspaceName } from "@/lib/workspace";

/** Agency overview: full blended + ads + store KPI set for the active client. */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; since?: string; until?: string }>;
}) {
  const workspaceId = await getActiveWorkspaceId();
  const workspaceName = await getWorkspaceName(workspaceId);
  const { range, preset } = resolveDateRange(await searchParams);

  return (
    <>
      <Topbar title={`Overview — ${workspaceName}`} />
      <main className="space-y-6 px-6 py-6">
        <DateRangePicker preset={preset} range={range} />
        <OverviewReport
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          range={range}
          preset={preset}
        />
      </main>
    </>
  );
}
