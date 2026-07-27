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
import { requireClientSession } from "@/lib/auth/client-session";
import { getWorkspaceName } from "@/lib/workspace";

/**
 * Same export as the admin dashboard's, scoped to the logged-in client's
 * own workspace via requireClientSession() — never a query-param
 * workspaceId — so one client can never pull another's data by editing the
 * URL. Deliberately lives under /client/* rather than /api/*: the
 * client_session cookie is set with path=/client (see client-session.ts),
 * so it's never even sent to a route outside that prefix — putting this
 * under /api/export would silently see no session at all.
 */
export async function GET(request: NextRequest) {
  const session = await requireClientSession();
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  if (!isExportableProvider(provider)) {
    return NextResponse.json({ error: "invalid or missing provider" }, { status: 400 });
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
    getCampaignsForExport(session.workspaceId, provider, range),
    getWorkspaceName(session.workspaceId),
  ]);

  return csvResponse(campaignsToCsv(campaigns), campaignExportFilename(workspaceName, provider, range));
}
