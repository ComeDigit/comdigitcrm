import { Topbar } from "@/components/shell/topbar";
import { Card, CardHeader, Badge, EmptyState } from "@/components/ui/primitives";
import { getPrincipal } from "@/lib/auth/principal";
import { getRecentAuditEvents, RECENT_EVENTS_LIMIT, type AuditEventRow } from "@/features/audit/queries";
import { getWorkspaces, getArchivedWorkspaces } from "@/features/crm/queries";
import { isDemoMode } from "@/lib/env";

export const metadata = { title: "Activity" };

function humanizeAction(action: string): string {
  return action.replace(/[._]/g, " ");
}

/** Only genuinely security-relevant events get flagged red — routine admin
 *  actions (suspend, disable, disconnect, delete/archive) are intentional
 *  decisions, not problems, so they stay neutral. */
function actionTone(action: string): "negative" | "outline" {
  return /login_failed|lockout/.test(action) ? "negative" : "outline";
}

function summarizeDetail(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const parts = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  if (parts.length === 0) return null;
  const joined = parts.join(", ");
  return joined.length > 140 ? `${joined.slice(0, 140)}…` : joined;
}

export default async function ActivityPage() {
  const principal = await getPrincipal();

  const [events, workspaces, archivedWorkspaces] = await Promise.all([
    getRecentAuditEvents(principal.orgId),
    isDemoMode ? Promise.resolve([]) : getWorkspaces(principal.orgId),
    isDemoMode ? Promise.resolve([]) : getArchivedWorkspaces(principal.orgId),
  ]);

  const workspaceName = new Map<string, string>();
  for (const w of [...workspaces, ...archivedWorkspaces]) workspaceName.set(w.id, w.name);

  const rowLabel = (e: AuditEventRow): string =>
    e.workspaceId ? (workspaceName.get(e.workspaceId) ?? "Deleted client") : "—";

  return (
    <>
      <Topbar title="Activity" />
      <main className="space-y-6 px-6 py-6">
        <Card>
          <CardHeader
            title="Audit log"
            subtitle={
              isDemoMode
                ? "Demo mode — connect Supabase to see real activity."
                : `Client logins, connection changes, and roster edits — most recent ${RECENT_EVENTS_LIMIT} events`
            }
          />
          <div className="px-5 pb-5 pt-2">
            {isDemoMode ? (
              <p className="text-xs text-muted">
                Demo mode has no audit trail to show — this becomes live the moment Supabase is connected.
              </p>
            ) : events.length === 0 ? (
              <EmptyState
                title="No activity yet"
                hint="Connect an integration, add a client login, or edit a client and it'll show up here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-widest text-muted">
                      <th className="py-2 pr-4 font-medium">When</th>
                      <th className="py-2 pr-4 font-medium">Event</th>
                      <th className="py-2 pr-4 font-medium">Client</th>
                      <th className="py-2 font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id} className="border-b border-border/60 align-top">
                        <td className="whitespace-nowrap py-2 pr-4 text-xs text-muted">
                          {new Date(e.createdAt).toLocaleString("en-IN")}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge tone={actionTone(e.action)}>{humanizeAction(e.action)}</Badge>
                        </td>
                        <td className="whitespace-nowrap py-2 pr-4 text-xs">{rowLabel(e)}</td>
                        <td className="py-2 text-xs text-muted">
                          {summarizeDetail(e.after) ?? summarizeDetail(e.before) ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      </main>
    </>
  );
}
