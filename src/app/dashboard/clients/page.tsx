import Link from "next/link";
import { Topbar } from "@/components/shell/topbar";
import { Card, CardHeader, Badge, EmptyState } from "@/components/ui/primitives";
import { getPrincipal } from "@/lib/auth/principal";
import { getContacts, getWorkspaces, getArchivedWorkspaces } from "@/features/crm/queries";
import {
  NewContactForm,
  NewWorkspaceForm,
  EditWorkspaceForm,
  WorkspaceStatusToggle,
  ArchiveWorkspaceForm,
  RestoreWorkspaceForm,
} from "@/features/crm/components/forms";
import { getShopDaily, lastNDays } from "@/features/metrics/queries";
import { getLiveShopifyReport } from "@/features/integrations/shopify-live";
import { sumShopFacts } from "@/lib/metrics/definitions";
import { formatMoney } from "@/lib/utils";
import { isDemoMode } from "@/lib/env";

export const metadata = { title: "Clients" };

const filterInputCls =
  "h-9 rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Agency client roster: every workspace is one client brand. */
export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const principal = await getPrincipal();
  const { q, status } = await searchParams;
  const search = (q ?? "").trim().toLowerCase();
  const statusFilter = status === "active" || status === "suspended" ? status : "all";

  const [workspaces, archivedWorkspaces, contacts] = await Promise.all([
    getWorkspaces(principal.orgId),
    getArchivedWorkspaces(principal.orgId),
    getContacts(principal.orgId),
  ]);

  const range = lastNDays(30);
  const revenue = await Promise.all(
    workspaces.map(async (ws) => {
      // Shopify is pulled live now (features/integrations/shopify-live.ts) —
      // nothing syncs orders into the database anymore, same "pull-on-demand"
      // shape as every ad channel. This used to call getShopDaily() even in
      // live mode, which reads a table nothing writes to any more, so every
      // client's revenue/orders here silently showed $0/0 in production
      // (AUDIT_REPORT.md, Bug #1 — Critical). Demo mode keeps using the
      // deterministic generator since there's no real store to pull from.
      const totals = isDemoMode
        ? sumShopFacts(await getShopDaily(ws.id, range))
        : (await getLiveShopifyReport(ws.id, range)).totals;
      return { id: ws.id, totals };
    }),
  );

  const filtered = workspaces.filter((ws) => {
    if (statusFilter !== "all" && ws.status !== statusFilter) return false;
    if (search && !ws.name.toLowerCase().includes(search)) return false;
    return true;
  });
  const isFiltered = Boolean(search) || statusFilter !== "all";

  return (
    <>
      <Topbar title="Clients" />
      <main className="space-y-6 px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form method="GET" className="flex flex-wrap items-center gap-2">
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
          <div className="flex gap-2">
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
          {filtered.map((ws) => {
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
                  <Link
                    href="/dashboard"
                    className="inline-block text-xs font-medium underline-offset-4 hover:underline"
                  >
                    Open dashboard →
                  </Link>
                </div>
                {!isDemoMode ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
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
                  <RestoreWorkspaceForm workspaceId={ws.id} />
                </Card>
              ))}
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
