import { Topbar } from "@/components/shell/topbar";
import { Card, CardHeader, Badge, Button } from "@/components/ui/primitives";
import { isDemoMode } from "@/lib/env";
import { getPrincipal } from "@/lib/auth/principal";
import { getActiveWorkspaceId } from "@/lib/workspace";

export const metadata = { title: "Settings" };

const PROVIDERS: Array<{
  key: string;
  label: string;
  phase: string;
  envVar?: string;
}> = [
  { key: "shopify", label: "Shopify", phase: "Phase 6" },
  { key: "meta", label: "Meta Ads", phase: "Phase 7", envVar: "META_APP_ID" },
  { key: "google_ads", label: "Google Ads", phase: "Phase 8" },
  { key: "tiktok", label: "TikTok Ads", phase: "Phase 9" },
  { key: "ga4", label: "Google Analytics 4", phase: "Phase 10" },
  { key: "search_console", label: "Search Console", phase: "Phase 10" },
];

async function getConnections(orgId: string) {
  if (isDemoMode) return [];
  const { getDb } = await import("@/lib/db");
  return getDb().query.integrationConnections.findMany({
    where: (c, { eq }) => eq(c.orgId, orgId),
  });
}

export default async function SettingsPage() {
  const principal = await getPrincipal();
  const workspaceId = await getActiveWorkspaceId();
  const connections = await getConnections(principal.orgId);
  const metaConfigured = Boolean(process.env.META_APP_ID);

  return (
    <>
      <Topbar title="Settings" />
      <main className="space-y-6 px-6 py-6">
        <Card>
          <CardHeader title="Environment" subtitle="How this deployment is configured" />
          <div className="space-y-2 px-5 pb-5 pt-2 text-[13px]">
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <span>Mode</span>
              <Badge tone={isDemoMode ? "outline" : "positive"}>
                {isDemoMode
                  ? "Demo (deterministic data, zero keys)"
                  : "Live (Supabase connected)"}
              </Badge>
            </div>
            {isDemoMode ? (
              <p className="text-xs leading-relaxed text-muted">
                To go live, follow <code className="rounded bg-surface-2 px-1">GO_LIVE.md</code>{" "}
                in the repo — create a free Supabase project, paste the keys
                into Vercel, run one SQL file. Everything else is already wired.
              </p>
            ) : (
              <p className="text-xs leading-relaxed text-muted">
                This deployment has no login wall — anyone with the URL sees
                this dashboard directly.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Integrations"
            subtitle="Each connector activates the moment its keys are added — the data pipeline behind them is already built"
          />
          <div className="space-y-2 px-5 pb-5 pt-2">
            {PROVIDERS.map((p) => {
              const existing = connections.filter((c) => c.provider === p.key);
              const canConnect = p.key === "meta" && metaConfigured && !isDemoMode;
              return (
                <div
                  key={p.key}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-[13px]"
                >
                  <div>
                    <span className="font-medium">{p.label}</span>
                    {existing.map((c) => (
                      <p key={c.id} className="text-xs text-muted">
                        {c.displayName} ·{" "}
                        <span
                          className={
                            c.status === "active" ? "text-positive" : "text-muted"
                          }
                        >
                          {c.status}
                        </span>
                        {c.lastSyncAt
                          ? ` · synced ${new Date(c.lastSyncAt).toLocaleString("en-IN")}`
                          : ""}
                      </p>
                    ))}
                  </div>
                  {canConnect ? (
                    <a href={`/api/integrations/meta/start?workspace=${workspaceId}`}>
                      <Button>Connect</Button>
                    </a>
                  ) : (
                    <Badge tone="outline">
                      {existing.length > 0
                        ? `${existing.length} connected`
                        : p.envVar && !isDemoMode
                          ? `Set ${p.envVar} to enable`
                          : `Ready · live in ${p.phase}`}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </main>
    </>
  );
}
