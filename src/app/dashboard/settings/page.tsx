import { Topbar } from "@/components/shell/topbar";
import { Card, CardHeader, Badge, Button } from "@/components/ui/primitives";
import { env, isDemoMode } from "@/lib/env";
import { getPrincipal } from "@/lib/auth/principal";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getWorkspaces } from "@/features/crm/queries";
import {
  ConnectMetaTokenForm,
  ConnectMetaAgencyForm,
} from "@/features/integrations/components/forms";
import { checkAgencyMetaTokenHealth } from "@/features/integrations/actions";
import { checkMetaAccountsHealth, type AccountHealth } from "@/features/integrations/meta-live";
import { ShareLinksManager } from "@/features/share/components/manager";
import { ClientPortalManager } from "@/features/client-portal/components/manager";

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
  const workspaces = isDemoMode ? [] : await getWorkspaces(principal.orgId);
  const metaConfigured = Boolean(process.env.META_APP_ID);
  const agencyTokenConfigured = Boolean(env.META_USER_TOKEN);
  const agencyTokenHealth = agencyTokenConfigured
    ? await checkAgencyMetaTokenHealth()
    : null;
  const agencyTokenWarning =
    agencyTokenHealth?.configured &&
    (!agencyTokenHealth.valid ||
      (agencyTokenHealth.daysUntilExpiry !== null && agencyTokenHealth.daysUntilExpiry <= 7));

  // Meta is reported on-demand now — there's no "last synced" timestamp to
  // show anymore, so instead probe each connected account live (cached 5min)
  // and show whether it's actually reachable right now.
  const metaWorkspaceIds = [
    ...new Set(connections.filter((c) => c.provider === "meta").map((c) => c.workspaceId)),
  ];
  const metaHealthByConnection = new Map<string, AccountHealth>();
  if (!isDemoMode) {
    const healthResults = await Promise.all(metaWorkspaceIds.map((wsId) => checkMetaAccountsHealth(wsId)));
    for (const list of healthResults) {
      for (const r of list) metaHealthByConnection.set(r.connectionId, r.health);
    }
  }
  const healthTone = (h: AccountHealth | undefined): "positive" | "outline" | "negative" => {
    if (h === "live") return "positive";
    if (h === "no_access") return "negative";
    return "outline";
  };
  const healthLabel = (h: AccountHealth | undefined): string => {
    if (h === "live") return "live · spend detected recently";
    if (h === "idle") return "reachable · no recent spend";
    if (h === "no_access") return "unreachable — check token";
    return "checking…";
  };

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
            {agencyTokenWarning ? (
              <div className="rounded-lg border border-negative/30 bg-negative/5 px-4 py-3 text-[13px]">
                <p className="font-medium text-negative">
                  {agencyTokenHealth && !agencyTokenHealth.valid
                    ? "Agency Meta token is no longer valid."
                    : `Agency Meta token expires in ${agencyTokenHealth?.daysUntilExpiry} day${agencyTokenHealth?.daysUntilExpiry === 1 ? "" : "s"}.`}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Generate a new long-lived token and update{" "}
                  <code className="rounded bg-surface-2 px-1">META_USER_TOKEN</code> in Vercel —
                  any client relying on the shared agency token will stop syncing once it expires.
                </p>
              </div>
            ) : null}
            {agencyTokenConfigured && agencyTokenHealth?.valid && !agencyTokenWarning ? (
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-[13px]">
                <span className="text-muted">Agency Meta token</span>
                <Badge tone="positive">
                  {agencyTokenHealth.daysUntilExpiry !== null
                    ? `Healthy · expires in ${agencyTokenHealth.daysUntilExpiry} days`
                    : "Healthy · no expiry"}
                </Badge>
              </div>
            ) : null}
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
                      <p key={c.id} className="flex items-center gap-1.5 text-xs text-muted">
                        <span>
                          {c.displayName} ·{" "}
                          <span className={c.status === "active" ? "text-positive" : "text-muted"}>
                            {c.status}
                          </span>
                        </span>
                        {p.key === "meta" && !isDemoMode ? (
                          <Badge tone={healthTone(metaHealthByConnection.get(c.id))}>
                            {healthLabel(metaHealthByConnection.get(c.id))}
                          </Badge>
                        ) : c.lastSyncAt ? (
                          `· synced ${new Date(c.lastSyncAt).toLocaleString("en-IN")}`
                        ) : null}
                      </p>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="outline">
                      {existing.length > 0
                        ? `${existing.length} connected`
                        : canConnect
                          ? "Not connected yet"
                          : p.envVar && !isDemoMode
                            ? `Set ${p.envVar} to enable`
                            : `Ready · live in ${p.phase}`}
                    </Badge>
                    {canConnect ? (
                      <a href={`/api/integrations/meta/start?workspace=${workspaceId}`}>
                        <Button>Connect</Button>
                      </a>
                    ) : null}
                    {p.key === "meta" && !isDemoMode ? (
                      <ConnectMetaTokenForm workspaces={workspaces} />
                    ) : null}
                    {p.key === "meta" && !isDemoMode && agencyTokenConfigured ? (
                      <ConnectMetaAgencyForm workspaces={workspaces} />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Share links"
            subtitle="Public, no-login report links for clients — one workspace and one channel per link, revocable any time"
          />
          <div className="px-5 pb-5 pt-2">
            {isDemoMode ? (
              <p className="text-xs text-muted">
                Demo mode — connect Supabase to create real share links.
              </p>
            ) : (
              <ShareLinksManager workspaces={workspaces} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Client portal logins"
            subtitle="Give a client their own username and password to sign in and see their full dashboard, locked to their workspace"
          />
          <div className="px-5 pb-5 pt-2">
            {isDemoMode ? (
              <p className="text-xs text-muted">
                Demo mode — connect Supabase to create real client logins.
              </p>
            ) : (
              <ClientPortalManager workspaces={workspaces} />
            )}
          </div>
        </Card>
      </main>
    </>
  );
}
