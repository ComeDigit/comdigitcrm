import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/shell/topbar";
import { Card, CardHeader, Badge } from "@/components/ui/primitives";
import { getPrincipal } from "@/lib/auth/principal";
import { getContacts, getWorkspaces } from "@/features/crm/queries";
import { NewContactForm } from "@/features/crm/components/forms";
import { getShopDaily, lastNDays } from "@/features/metrics/queries";
import { sumShopFacts } from "@/lib/metrics/definitions";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Clients" };

/** Agency client roster: every workspace is one client brand. */
export default async function ClientsPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const [workspaces, contacts] = await Promise.all([
    getWorkspaces(principal.orgId),
    getContacts(principal.orgId),
  ]);

  const revenue = await Promise.all(
    workspaces.map(async (ws) => {
      const totals = sumShopFacts(await getShopDaily(ws.id, lastNDays(30)));
      return { id: ws.id, totals };
    }),
  );

  return (
    <>
      <Topbar title="Clients" />
      <main className="space-y-6 px-6 py-6">
        <div className="flex justify-end">
          <NewContactForm workspaces={workspaces} />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {workspaces.map((ws) => {
            const totals = revenue.find((r) => r.id === ws.id)?.totals;
            const wsContacts = contacts.filter((c) => c.workspaceId === ws.id);
            return (
              <Card key={ws.id} className="flex flex-col">
                <CardHeader
                  title={ws.name}
                  subtitle={ws.vertical ?? "Client brand"}
                  action={<Badge tone="positive">Active</Badge>}
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
                  <Link
                    href="/dashboard"
                    className="inline-block text-xs font-medium underline-offset-4 hover:underline"
                  >
                    Open dashboard →
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      </main>
    </>
  );
}
