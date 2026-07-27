import { type NextRequest } from "next/server";
import { getPrincipal } from "@/lib/auth/principal";
import {
  getWorkspaces,
  getContacts,
  getClientRevenueTotals,
  filterAndSortWorkspaces,
  type WorkspaceRow,
  type ContactRow,
} from "@/features/crm/queries";
import { lastNDays } from "@/features/metrics/queries";
import { clientsToCsv } from "@/features/crm/clients-export";
import { csvResponse } from "@/lib/csv";
import type { ShopFacts } from "@/lib/metrics/definitions";

/**
 * Client roster CSV — admin only, no client-portal equivalent (a client
 * has no reason to see the whole agency's roster). Same 30-day window and
 * same filter/sort semantics as the Clients page cards, via the shared
 * filterAndSortWorkspaces()/getClientRevenueTotals() helpers in
 * features/crm/queries.ts, so the CSV always matches what's on screen.
 * Unlike the page, this always fetches revenue for every filtered client
 * rather than only the current page — a CSV export is inherently a
 * "give me everything that matches" action, not a paginated view.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const principal = await getPrincipal();
  const range = lastNDays(30);

  const [workspaces, contacts] = await Promise.all([
    getWorkspaces(principal.orgId),
    getContacts(principal.orgId),
  ]);

  const statusParam = searchParams.get("status");
  const status = statusParam === "active" || statusParam === "suspended" ? statusParam : "all";
  const filtered = filterAndSortWorkspaces(workspaces, {
    search: searchParams.get("q") ?? undefined,
    status,
  });

  const withTotals: Array<{ workspace: WorkspaceRow; totals: ShopFacts; contacts: ContactRow[] }> = await Promise.all(
    filtered.map(async (ws) => ({
      workspace: ws,
      totals: await getClientRevenueTotals(ws.id, range),
      contacts: contacts.filter((c) => c.workspaceId === ws.id),
    })),
  );

  const sort = searchParams.get("sort");
  withTotals.sort((a, b) => {
    if (sort === "revenue") return b.totals.netSalesMinor - a.totals.netSalesMinor;
    if (sort === "name_desc") return b.workspace.name.localeCompare(a.workspace.name);
    return a.workspace.name.localeCompare(b.workspace.name);
  });

  return csvResponse(clientsToCsv(withTotals), `clients-${range.since}-to-${range.until}.csv`);
}
