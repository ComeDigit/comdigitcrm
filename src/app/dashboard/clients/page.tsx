import Link from "next/link";
import { Download } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { OpenClientDashboardLink } from "@/components/shell/workspace-switcher";
import { Card, CardHeader, Badge, EmptyState, LinkButton } from "@/components/ui/primitives";
import { PrintButton } from "@/components/shared/print-button";
import { getPrincipal } from "@/lib/auth/principal";
import {
  getContacts,
  getWorkspaces,
  getArchivedWorkspaces,
  getClientRevenueTotals,
  filterAndSortWorkspaces,
  type WorkspaceRow,
} from "@/features/crm/queries";
import {
  NewContactForm,
  NewWorkspaceForm,
  EditWorkspaceForm,
  WorkspaceStatusToggle,
  ArchiveWorkspaceForm,
  RestoreWorkspaceForm,
} from "@/features/crm/components/forms";
import { lastNDays } from "@/features/metrics/queries";
import type { ShopFacts } from "@/lib/metrics/definitions";
import { formatMoney } from "@/lib/utils";
import { isDemoMode } from "@/lib/env";

export const metadata = { title: "Clients" };

const filterInputCls =
  "h-9 rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

// AUDIT_REPORT.md — Medium: "Pagination and sorting absent everywhere;
// every list (clients, campaigns) renders unpaginated and unsorted." 12
// per page matches the 3-column grid (4 full rows on desktop).
const PAGE_SIZE = 12;
type ClientSort = "name" | "name_desc" | "revenue";

/** Agency client roster: every workspace is one client brand. */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string; page?: string }>;
}) {
  const principal = await getPrincipal();
  const { q, status, sort, page } = await searchParams;
  const search = (q ?? "").trim().toLowerCase();
  const statusFilter = status === "active" || status === "suspended" ? status : "all";
  const sortKey: ClientSort = sort === "revenue" || sort === "name_desc" ? sort : "name";
  const requestedPage = Math.max(1, parseInt(page ?? "1", 10) || 1);

  const [workspaces, archivedWorkspaces, contacts] = await Promise.all([
    getWorkspaces(principal.orgId),
    getArchivedWorkspaces(principal.orgId),
    getContacts(principal.orgId),
  ]);

  const range = lastNDays(30);

  const filtered = filterAndSortWorkspaces(workspaces, { search, status: statusFilter });
  const isFiltered = Boolean(search) || statusFilter !== "all";

  // Sorting by revenue needs every filtered workspace's totals up front —
  // you can't sort by a number you haven't fetched yet. Sorting by name
  // doesn't, so that path only fetches revenue for the page actually being
  // shown, which is the real fix for "renders unpaginated" costing one
  // live Shopify pull per client on every page load regardless of filters.
  let pageItems: WorkspaceRow[];
  let revenue: Array<{ id: string; totals: ShopFacts }>;
  let totalPages: number;
  let currentPage: number;

  if (sortKey === "revenue") {
    const withRevenue = await Promise.all(
      filtered.map(async (ws) => ({ ws, totals: await getClientRevenueTotals(ws.id, range) })),
    );
    withRevenue.sort((a, b) => b.totals.netSalesMinor - a.totals.netSalesMinor);
    totalPages = Math.max(1, Math.ceil(withRevenue.length / PAGE_SIZE));
    currentPage = Math.min(requestedPage, totalPages);
    const slice = withRevenue.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    pageItems = slice.map((s) => s.ws);
    revenue = slice.map((s) => ({ id: s.ws.id, totals: s.totals }));
  } else {
    const sorted = [...filtered].sort((a, b) =>
      sortKey === "name_desc" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name),
    );
    totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    currentPage = Math.min(requestedPage, totalPages);
    pageItems = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    revenue = await Promise.all(
      pageItems.map(async (ws) => ({ id: ws.id, totals: await getClientRevenueTotals(ws.id, range) })),
    );
  }

  /** Prev/Next links carry q/status/sort forward and only set an explicit
   *  page when it isn't page 1, keeping URLs clean for the common case. */
  function clientsPageHref(targetPage: number): string {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (sortKey !== "name") params.set("sort", sortKey);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/dashboard/clients?${qs}` : "/dashboard/clients";
  }

  /** Same q/status/sort as clientsPageHref, minus page — export is always
   *  "every matching client," not just the page currently on screen. */
  function clientsExportHref(): string {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (sortKey !== "name") params.set("sort", sortKey);
    const qs = params.toString();
    return qs ? `/api/export/clients?${qs}` : "/api/export/clients";
  }

  return (
    <>
      <Topbar title="Clients" />
      <main className="space-y-6 px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form method="GET" className="flex flex-wrap items-center gap-2 print:hidden">
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search clients…"
              className={`${filterInputCls} w-52`}
            />
            <select name="status" defaultValue={statusFilter} className={filterInputCls}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
            <select name="sort" defaultValue={sortKey} className={filterInputCls}>
              <option value="name">Name A–Z</option>
              <option value="name_desc">Name Z–A</option>
              <option value="revenue">Revenue (30d, high to low)</option>
            </select>
            <button
              type="submit"
              className="h-9 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"
            >
              Filter
            </button>
            {isFiltered ? (
              <Link
                href="/dashboard/clients"
                className="text-xs font-medium text-muted underline-offset-4 hover:underline"
              >
                Clear
              </Link>
            ) : null}
          </form>
          <div className="flex gap-2 print:hidden">
            <LinkButton variant="outline" href={clientsExportHref()}>
              <Download size={13} /> Export CSV
            </LinkButton>
            <PrintButton />
            <NewWorkspaceForm />
            <NewContactForm workspaces={workspaces} />
          </div>
        </div>

        {isFiltered && filtered.length === 0 ? (
          <EmptyState
            title="No clients match this search"
            hint="Try a different name, or clear the status filter."
          />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          {pageItems.map((ws) => {
            const totals = revenue.find((r) => r.id === ws.id)?.totals;
            const wsContacts = contacts.filter((c) => c.workspaceId === ws.id);
            return (
              <Card key={ws.id} className="flex flex-col">
                <CardHeader
                  title={ws.name}
                  subtitle={ws.vertical ?? "Client brand"}
                  action={
                    <Badge tone={ws.status === "active" ? "positive" : "outline"}>
                      {ws.status === "active" ? "Active" : "Suspended"}
                    </Badge>
                  }
                />
                <div className="flex-1 space-y-3 px-5 pb-5 pt-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted">Net revenue (30d)</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {totals ? formatMoney(totals.netSalesMinor) : "—"}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted">Orders (30d)</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {totals ? totals.orders.toLocaleString("en-IN") : "—"}
                    </span>
                  </div>
                  <div className="border-t border-border pt-3">
                    <p className="pb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted">
                      Contacts
                    </p>
                    {wsContacts.length === 0 ? (
                      <p className="text-xs text-muted">No contacts yet</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {wsContacts.map((c) => (
                          <li key={c.id} className="text-[13px]">
                            <span className="font-medium">{c.fullName}</span>
                            {c.title ? (
                              <span className="text-muted"> · {c.title}</span>
                            ) : null}
                            {c.email ? (
                              <p className="text-xs text-muted">{c.email}</p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {ws.website ? (
                    <a
                      href={ws.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-xs text-muted underline-offset-4 hover:underline"
                    >
                      {ws.website}
                    </a>
                  ) : null}
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <OpenClientDashboardLink
                      workspaceId={ws.id}
                      className="inline-block text-xs font-medium underline-offset-4 hover:underline"
                    />
                    <Link
                      href={`/dashboard/clients/${ws.id}`}
                      className="inline-block text-xs font-medium underline-offset-4 hover:underline"
                    >
                      Connect accounts & create login →
                    </Link>
                  </div>
                </div>
                {!isDemoMode ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 print:hidden">
                    <EditWorkspaceForm
                      workspace={{ id: ws.id, name: ws.name, website: ws.website }}
                    />
                    <WorkspaceStatusToggle workspaceId={ws.id} status={ws.status} />
                    <ArchiveWorkspaceForm workspaceId={ws.id} name={ws.name} />
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>

        {totalPages > 1 ? (
          <div className="flex items-center justify-center gap-3 pt-1 print:hidden">
            {currentPage > 1 ? (
              <Link
                href={clientsPageHref(currentPage - 1)}
                className="text-xs font-medium underline-offset-4 hover:underline"
              >
                ← Previous
              </Link>
            ) : (
              <span className="text-xs text-muted/50">← Previous</span>
            )}
            <span className="text-xs text-muted">
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages ? (
              <Link
                href={clientsPageHref(currentPage + 1)}
                className="text-xs font-medium underline-offset-4 hover:underline"
              >
                Next →
              </Link>
            ) : (
              <span className="text-xs text-muted/50">Next →</span>
            )}
          </div>
        ) : null}

        {archivedWorkspaces.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-widest text-muted">
              Archived clients
            </p>
            <div className="grid gap-3 lg:grid-cols-3">
              {archivedWorkspaces.map((ws) => (
                <Card key={ws.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-[13px] font-medium">{ws.name}</p>
                    <p className="text-xs text-muted">
                      Archived{" "}
                      {ws.archivedAt ? new Date(ws.archivedAt).toLocaleDateString("en-IN") : ""}
                    </p>
                  </div>
                  <span className="print:hidden">
                    <RestoreWorkspaceForm workspaceId={ws.id} />
                  </span>
                </Card>
              ))}
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
