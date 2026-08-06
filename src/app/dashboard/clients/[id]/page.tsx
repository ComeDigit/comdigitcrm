import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/topbar";
import { Card, CardHeader, Badge, Button } from "@/components/ui/primitives";
import { isDemoMode } from "@/lib/env";
import { getPrincipal } from "@/lib/auth/principal";
import { getWorkspaces, getArchivedWorkspaces } from "@/features/crm/queries";
import {
  EditWorkspaceForm,
  WorkspaceStatusToggle,
  ArchiveWorkspaceForm,
  RestoreWorkspaceForm,
} from "@/features/crm/components/forms";
import {
  ConnectMetaTokenForm,
  ConnectMetaAgencyForm,
  ConnectShopifyForm,
  ConnectShopifyOAuthForm,
  ConnectGoogleAdsAgencyForm,
  ConnectTikTokTokenForm,
  DisconnectConnectionButton,
} from "@/features/integrations/components/forms";
import { PROVIDERS, getProviderAvailability } from "@/features/integrations/provider-config";
import { getWorkspaceConnections } from "@/features/integrations/connection-queries";
import { checkMetaAccountsHealth, type AccountHealth } from "@/features/integrations/meta-live";
import { checkShopifyAccountsHealth } from "@/features/integrations/shopify-live";
import { checkGoogleAdsAccountsHealth } from "@/features/integrations/google-ads-live";
import { checkTikTokAccountsHealth } from "@/features/integrations/tiktok-live";
import { ClientPortalManager } from "@/features/client-portal/components/manager";
import { OpenClientDashboardLink } from "@/components/shell/workspace-switcher";

export const metadata = { title: "Client" };

/**
 * One place per client: connect THIS client's own Meta/Google Ads/TikTok/
 * Shopify accounts and create THEIR login, without re-picking the client
 * from a dropdown each time (that's what the global Settings page's
 * Integrations/Client-portal-logins cards required, which is the exact gap
 * flagged from the client's side of this app).
 *
 * Dynamic route segment with no generateStaticParams — Next.js already
 * renders this per request rather than attempting to prerender it at build
 * time (there is no fixed set of ids to enumerate). Forced explicitly
 * anyway: this project has twice shipped a build that crashed outright
 * because a page with no dynamic signal got attempted for static
 * prerendering at `next build` time and a query threw (see
 * dashboard/activity, dashboard/tasks) — being explicit here removes all
 * doubt rather than relying on that inference.
 */
export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const principal = await getPrincipal();

  const [workspaces, archivedWorkspaces] = await Promise.all([
    getWorkspaces(principal.orgId),
    getArchivedWorkspaces(principal.orgId),
  ]);
  const workspace = [...workspaces, ...archivedWorkspaces].find((w) => w.id === id);
  if (!workspace) notFound();

  const isArchived = Boolean(workspace.archivedAt);
  const singleWorkspaceArray = [{ id: workspace.id, name: workspace.name }];

  const connections = await getWorkspaceConnections(principal.orgId, workspace.id);
  const {
    metaConfigured,
    shopifyOAuthConfigured,
    agencyTokenConfigured,
    googleAdsConfigured,
    googleAdsAgencyConfigured,
    tiktokConfigured,
  } = getProviderAvailability();

  // Same on-demand "is it actually reachable right now" probe Settings
  // runs, just scoped to this one workspace instead of every workspace
  // that has a connection for each provider.
  const healthByConnection = new Map<string, AccountHealth>();
  // Connection ids are unique across providers, so one reason map serves all
  // four probes. It explains a "no_access" without a trip to the Vercel log.
  const healthReasonByConnection = new Map<string, string>();
  if (!isDemoMode) {
    const lists = await Promise.all([
      connections.some((c) => c.provider === "meta")
        ? checkMetaAccountsHealth(workspace.id)
        : Promise.resolve([]),
      connections.some((c) => c.provider === "shopify")
        ? checkShopifyAccountsHealth(workspace.id)
        : Promise.resolve([]),
      connections.some((c) => c.provider === "google_ads")
        ? checkGoogleAdsAccountsHealth(workspace.id)
        : Promise.resolve([]),
      connections.some((c) => c.provider === "tiktok")
        ? checkTikTokAccountsHealth(workspace.id)
        : Promise.resolve([]),
    ]);
    for (const list of lists)
      for (const r of list) {
        healthByConnection.set(r.connectionId, r.health);
        if (r.reason) healthReasonByConnection.set(r.connectionId, r.reason);
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
      <Topbar title={workspace.name} />
      <main className="space-y-6 px-6 py-6">
        <Link
          href="/dashboard/clients"
          className="inline-block text-xs font-medium text-muted underline-offset-4 hover:underline"
        >
          ← All clients
        </Link>

        <Card>
          <CardHeader
            title={workspace.name}
            subtitle="Connect this client's ad/store accounts and manage their login below"
            action={
              <Badge tone={workspace.status === "active" ? "positive" : "outline"}>
                {isArchived ? "Archived" : workspace.status === "active" ? "Active" : "Suspended"}
              </Badge>
            }
          />
          <div className="flex flex-wrap items-center gap-2 px-5 pb-5 pt-2 print:hidden">
            <OpenClientDashboardLink
              workspaceId={workspace.id}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"
            />
            {!isDemoMode && !isArchived ? (
              <>
                <EditWorkspaceForm
                  workspace={{ id: workspace.id, name: workspace.name, website: workspace.website }}
                />
                <WorkspaceStatusToggle workspaceId={workspace.id} status={workspace.status} />
                <ArchiveWorkspaceForm workspaceId={workspace.id} name={workspace.name} />
              </>
            ) : null}
            {!isDemoMode && isArchived ? (
              <RestoreWorkspaceForm workspaceId={workspace.id} />
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Integrations"
            subtitle={`Connect ${workspace.name}'s own Meta, Google Ads, TikTok, and Shopify accounts — each one lands on this client automatically, no picker needed`}
          />
          <div className="space-y-2 px-5 pb-5 pt-2">
            {isDemoMode ? (
              <p className="text-xs text-muted">
                Demo mode — connect Supabase to connect real accounts for this client.
              </p>
            ) : (
              PROVIDERS.map((p) => {
                const existing = connections.filter((c) => c.provider === p.key);
                const canConnect =
                  (p.key === "meta" && metaConfigured) ||
                  (p.key === "google_ads" && googleAdsConfigured) ||
                  (p.key === "tiktok" && tiktokConfigured);
                const hasConnectUi =
                  p.key === "meta" ||
                  p.key === "shopify" ||
                  (p.key === "google_ads" && (googleAdsConfigured || googleAdsAgencyConfigured)) ||
                  (p.key === "tiktok" && tiktokConfigured);
                return (
                  <div
                    key={p.key}
                    className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-[13px]"
                  >
                    <div>
                      <span className="font-medium">{p.label}</span>
                      {existing.map((c) => (
                        <p
                          key={c.id}
                          className="flex flex-wrap items-center gap-1.5 text-xs text-muted"
                        >
                          <span>
                            {c.displayName} ·{" "}
                            <span className={c.status === "active" ? "text-positive" : "text-muted"}>
                              {c.status}
                            </span>
                          </span>
                          <>
                            <Badge
                              tone={healthTone(healthByConnection.get(c.id))}
                              title={healthReasonByConnection.get(c.id)}
                            >
                              {healthLabel(healthByConnection.get(c.id))}
                            </Badge>
                            {healthReasonByConnection.get(c.id) ? (
                              <span className="text-negative">
                                {healthReasonByConnection.get(c.id)}
                              </span>
                            ) : null}
                          </>
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
                            : p.envVar
                              ? `Set ${p.envVar} to enable`
                              : `Ready · live in ${p.phase}`}
                      </Badge>
                      {canConnect ? (
                        <a href={`/api/integrations/${p.key}/start?workspace=${workspace.id}`}>
                          <Button>Connect</Button>
                        </a>
                      ) : null}
                      {p.key === "meta" ? (
                        <ConnectMetaTokenForm workspaces={singleWorkspaceArray} />
                      ) : null}
                      {p.key === "meta" && agencyTokenConfigured ? (
                        <ConnectMetaAgencyForm workspaces={singleWorkspaceArray} />
                      ) : null}
                      {p.key === "shopify" && shopifyOAuthConfigured ? (
                        <ConnectShopifyOAuthForm workspaceId={workspace.id} />
                      ) : null}
                      {p.key === "shopify" ? (
                        <ConnectShopifyForm workspaces={singleWorkspaceArray} />
                      ) : null}
                      {p.key === "google_ads" && googleAdsAgencyConfigured ? (
                        <ConnectGoogleAdsAgencyForm workspaces={singleWorkspaceArray} />
                      ) : null}
                      {p.key === "tiktok" && tiktokConfigured ? (
                        <ConnectTikTokTokenForm workspaces={singleWorkspaceArray} />
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Client login"
            subtitle={`Give ${workspace.name} their own username and password — they'll sign in and see only this workspace's Meta, Google Ads, TikTok, and Shopify report`}
          />
          <div className="px-5 pb-5 pt-2">
            {isDemoMode ? (
              <p className="text-xs text-muted">
                Demo mode — connect Supabase to create a real client login.
              </p>
            ) : (
              <ClientPortalManager workspaces={singleWorkspaceArray} />
            )}
          </div>
        </Card>
      </main>
    </>
  );
}
