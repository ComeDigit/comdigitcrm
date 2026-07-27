import { NextResponse, type NextRequest } from "next/server";
import {
  getCampaignsForExport,
  campaignsToCsv,
  campaignExportFilename,
  isExportableProvider,
  isValidDateParam,
} from "@/features/ads/campaigns-export";
import { resolveDateRange } from "@/features/metrics/queries";
import { csvResponse } from "@/lib/csv";
import { getActiveWorkspaceId, getWorkspaceName } from "@/lib/workspace";

/**
 * Campaigns CSV for the internal dashboard. Auth is exactly the "ws"
 * cookie every /dashboard/* page already trusts (getActiveWorkspaceId) —
 * never a client-supplied workspaceId param — so this can only ever export
 * whichever workspace the agency currently has selected in its own
 * switcher. See features/ads/campaigns-export.ts for why the client-portal
 * export isn't this same route.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  if (!isExportableProvider(provider)) {
    return NextResponse.json({ error: "invalid or missing provider" }, { status: 400 });
  }

  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ error: "no active workspace" }, { status: 400 });
  }

  const since = searchParams.get("since");
  const until = searchParams.get("until");
  if (!isValidDateParam(since) || !isValidDateParam(until)) {
    return NextResponse.json({ error: "since/until must be YYYY-MM-DD" }, { status: 400 });
  }

  const { range } = resolveDateRange({
    preset: searchParams.get("preset") ?? undefined,
    since: since ?? undefined,
    until: until ?? undefined,
  });

  const [campaigns, workspaceName] = await Promise.all([
    getCampaignsForExport(workspaceId, provider, range),
    getWorkspaceName(workspaceId),
  ]);

  return csvResponse(campaignsToCsv(campaigns), campaignExportFilename(workspaceName, provider, range));
}
