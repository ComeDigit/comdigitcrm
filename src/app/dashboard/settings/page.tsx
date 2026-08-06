import { Topbar } from "@/components/shell/topbar";
import { Card, CardHeader, Badge, Button } from "@/components/ui/primitives";
import { isDemoMode } from "@/lib/env";
import { getPrincipal } from "@/lib/auth/principal";
import { getActiveWorkspaceId } from "@/lib/workspace";
import { getWorkspaces, getArchivedWorkspaces } from "@/features/crm/queries";
import {
  ConnectMetaTokenForm,
  ConnectMetaAgencyForm,
  AutoProvisionMetaAccountsButton,
  ConnectShopifyForm,
  ConnectShopifyOAuthForm,
  ConnectGoogleAdsAgencyForm,
  ConnectTikTokTokenForm,
  DisconnectConnectionButton,
} from "@/features/integrations/components/forms";
import { checkAgencyMetaTokenHealth } from "@/features/integrations/actions";
import { checkMetaAccountsHealth, type AccountHealth } from "@/features/integrations/meta-live";
import { checkShopifyAccountsHealth } from "@/features/integrations/shopify-live";
import { checkGoogleAdsAccountsHealth } from "@/features/integrations/google-ads-live";
import { checkTikTokAccountsHealth } from "@/features/integrations/tiktok-live";
import { ShareLinksManager } from "@/features/share/components/manager";
import { ClientPortalManager } from "@/features/client-portal/components/manager";
import { PROVIDERS, getProviderAvailability } from "@/features/integrations/provider-config";
import { getOrgConnections } from "@/features/integrations/connection-queries";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const principal = await getPrincipal();
  const workspaceId = await getActiveWorkspaceId();
  const connections = await getOrgConnections(principal.orgId);
  const workspaces = isDemoMode ? [] : await getWorkspaces(principal.orgId);
  const archivedWorkspaces = isDemoMode ? [] : await getArchivedWorkspaces(principal.orgId);
  // Connections span every client — without this label, a Meta/Shopify/
  // Google Ads/TikTok connection only ever shows its own ad-account/store
  // name, with no indication of WHICH client it belongs to (AUDIT_REPORT.md
  // — Partial: "global connected-accounts view doesn't label by client").
  const workspaceNameById = new Map<string, string>();
  for (const w of [...workspaces, ...archivedWorkspaces]) workspaceNameById.set(w.id, w.name);
  const {
    metaConfigured,
    shopifyOAuthConfigured,
    agencyTokenConfigured,
    googleAdsConfigured,
    googleAdsAgencyConfigured,
    tiktokConfigured,
  } = getProviderAvailability();
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
  // Connection ids are unique across providers, so one reason map serves all
  // four probes. It backs the badge tooltip that explains a "no_access".
  const healthReasonByConnection = new Map<string, string>();
  if (!isDemoMode) {
    const healthResults = await Promise.all(metaWorkspaceIds.map((wsId) => checkMetaAccountsHealth(wsId)));
    for (const list of healthResults) {
      for (const r of list) {
        metaHealthByConnection.set(r.connectionId, r.health);
        if (r.reason) healthReasonByConnection.set(r.connectionId, r.reason);
      }
    }
  }

  // Same on-demand health probe for Shopify — ShopifyAccountHealth is the
  // same "live" | "idle" | "no_access" shape as Meta's AccountHealth, so it
  // shares the tone/label helpers below.
  const shopifyWorkspaceIds = [
    ...new Set(connections.filter((c) => c.provider === "shopify").map((c) => c.workspaceId)),
  ];
  const shopifyHealthByConnection = new Map<string, AccountHealth>();
  if (!isDemoMode) {
    const shopifyHealthResults = await Promise.all(
      shopifyWorkspaceIds.map((wsId) => checkShopifyAccountsHealth(wsId)),
    );
    for (const list of shopifyHealthResults) {
      for (const r of list) {
        shopifyHealthByConnection.set(r.connectionId, r.health);
        if (r.reason) healthReasonByConnection.set(r.connectionId, r.reason);
      }
    }
  }

  // Same on-demand health probe for Google Ads — checkGoogleAdsAccountsHealth
  // returns the same "live" | "idle" | "no_access" shape too.
  const googleAdsWorkspaceIds = [
    ...new Set(connections.filter((c) => c.provider === "google_ads").map((c) => c.workspaceId)),
  ];
  const googleAdsHealthByConnection = new Map<string, AccountHealth>();
  if (!isDemoMode) {
    const googleAdsHealthResults = await Promise.all(
      googleAdsWorkspaceIds.map((wsId) => checkGoogleAdsAccountsHealth(wsId)),
    );
    for (const list of googleAdsHealthResults) {
      for (const r of list) {
        googleAdsHealthByConnection.set(r.connectionId, r.health);
        if (r.reason) healthReasonByConnection.set(r.connectionId, r.reason);
      }
    }
  }

  // Same on-demand health probe for TikTok.
  const tiktokWorkspaceIds = [
    ...new Set(connections.filter((c) => c.provider === "tiktok").map((c) => c.workspaceId)),
  ];
  const tiktokHealthByConnection = new Map<string, AccountHealth>();
  if (!isDemoMode) {
    const tiktokHealthResults = await Promise.all(
      tiktokWorkspaceIds.map((wsId) => checkTikTokAccountsHealth(wsId)),
    );
    for (const list of tiktokHealthResults) {
      for (const r of list) {
        tiktokHealthByConnection.set(r.connectionId, r.health);
        if (r.reason) healthReasonByConnection.set(r.connectionId, r.reason);
      }
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
              const canConnect =
                !isDemoMode &&
                ((p.key === "meta" && metaConfigured) ||
                  (p.key === "google_ads" && googleAdsConfigured) ||
                  (p.key === "tiktok" && tiktokConfigured));
              const hasConnectUi =
                !isDemoMode &&
                (p.key === "meta" ||
                  p.key === "shopify" ||
                  (p.key === "google_ads" && (googleAdsConfigured || googleAdsAgencyConfigured)) ||
                  (p.key === "tiktok" && tiktokConfigured));
              const healthMap =
                p.key === "meta"
                  ? metaHealthByConnection
                  : p.key === "shopify"
                    ? shopifyHealthByConnection
                    : p.key === "google_ads"
                      ? googleAdsHealthByConnection
                      : p.key === "tiktok"
                        ? tiktokHealthByConnection
                        : null;
              return (
                <div
                  key={p.key}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-[13px]"
                >
                  <div>
                    <span className="font-medium">{p.label}</span>
                    {existing.map((c) => (
                      <p key={c.id} className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span className="font-medium text-foreground">
                          {workspaceNameById.get(c.workspaceId) ?? "Deleted client"}
                        </span>
                        <span>
                          — {c.displayName} ·{" "}
                          <span className={c.status === "active" ? "text-positive" : "text-muted"}>
                            {c.status}
                          </span>
                        </span>
                        {healthMap ? (
                          <>
                            <Badge
                              tone={healthTone(healthMap.get(c.id))}
                              title={healthReasonByConnection.get(c.id)}
                            >
                              {healthLabel(healthMap.get(c.id))}
                            </Badge>
                            {healthReasonByConnection.get(c.id) ? (
                              // Shown inline rather than tooltip-only: a
                              // failing account is exactly the case where
                              // the operator shouldn't have to go hunting.
                              <span className="text-negative">
                                {healthReasonByConnection.get(c.id)}
                              </span>
                            ) : null}
                          </>
                        ) : c.lastSyncAt ? (
                          `· synced ${new Date(c.lastSyncAt).toLocaleString("en-IN")}`
                        ) : null}
                        {c.status === "active" ? (
                          <DisconnectConnectionButton connectionId={c.id} workspaceId={c.workspaceId} />
                        ) : null}
                      </p>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="outline">
                      {existing.length > 0
                        ? `${existing.length} connected`
                        : hasConnectUi
                          ? "Not connected yet"
                          : p.envVar && !isDemoMode
                            ? `Set ${p.envVar} to enable`
                            : `Ready · live in ${p.phase}`}
                    </Badge>
                    {canConnect ? (
                      <a href={`/api/integrations/${p.key}/start?workspace=${workspaceId}`}>
                        <Button>Connect</Button>
                      </a>
                    ) : null}
                    {p.key === "meta" && !isDemoMode ? (
                      <ConnectMetaTokenForm workspaces={workspaces} />
                    ) : null}
                    {p.key === "meta" && !isDemoMode && agencyTokenConfigured ? (
                      <ConnectMetaAgencyForm workspaces={workspaces} />
                    ) : null}
                    {p.key === "meta" && !isDemoMode && agencyTokenConfigured ? (
                      <AutoProvisionMetaAccountsButton />
                    ) : null}
                    {p.key === "shopify" && !isDemoMode && shopifyOAuthConfigured ? (
                      <ConnectShopifyOAuthForm workspaceId={workspaceId} />
                    ) : null}
                    {p.key === "shopify" && !isDemoMode ? (
                      <ConnectShopifyForm workspaces={workspaces} />
                    ) : null}
                    {p.key === "google_ads" && !isDemoMode && googleAdsAgencyConfigured ? (
                      <ConnectGoogleAdsAgencyForm workspaces={workspaces} />
                    ) : null}
                    {p.key === "tiktok" && !isDemoMode && tiktokConfigured ? (
                      <ConnectTikTokTokenForm workspaces={workspaces} />
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
