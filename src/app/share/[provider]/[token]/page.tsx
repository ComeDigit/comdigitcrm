import { notFound } from "next/navigation";
import { AdsReport, resolveCampaignTableParams } from "@/features/ads/channel-page";
import { resolveShareLink } from "@/features/share/actions";
import { resolveDateRange } from "@/features/metrics/queries";
import { getWorkspaceName } from "@/lib/workspace";
import { ThemeToggle } from "@/components/shell/theme";
import type { DemoProvider } from "@/features/demo-data/generator";

/**
 * Public, no-login report — the third access tier alongside the internal
 * team dashboard and the client's own login-free dashboard. Deliberately
 * outside the /dashboard route tree: no Sidebar, no Topbar, no workspace
 * switcher, and it renders the SAME <AdsReport> body every internal channel
 * page uses so this view can never drift out of sync with the real
 * dashboard. Anyone with a valid, unrevoked token sees exactly one
 * workspace's one provider report — nothing else in the app is reachable
 * from here.
 */

export const metadata = { title: "Shared report" };

const PROVIDER_LABELS: Record<DemoProvider, string> = {
  meta: "Meta Ads",
  google_ads: "Google Ads",
  tiktok: "TikTok Ads",
};

function isDemoProvider(value: string): value is DemoProvider {
  return value === "meta" || value === "google_ads" || value === "tiktok";
}

export default async function SharedReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string; token: string }>;
  searchParams: Promise<{ preset?: string; since?: string; until?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const { provider, token } = await params;
  if (!isDemoProvider(provider)) notFound();
  const resolvedParams = await searchParams;
  const { range, preset } = resolveDateRange(resolvedParams);
  const { sortKey, sortDir, page } = resolveCampaignTableParams(resolvedParams);

  const link = await resolveShareLink(provider, token);
  if (!link) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium">This share link isn&apos;t available.</p>
          <p className="mt-1 text-xs text-muted">
            It may have been revoked, or the link is incorrect. Ask whoever sent it for a fresh one.
          </p>
        </div>
      </main>
    );
  }

  const workspaceName = await getWorkspaceName(link.workspaceId);
  const providerLabel = PROVIDER_LABELS[provider];
  const heading = link.label ?? `${providerLabel} — ${workspaceName}`;

  return (
    <>
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur print:hidden">
        <h1 className="text-sm font-semibold tracking-tight">{heading}</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">Shared report · read-only</span>
          <ThemeToggle />
        </div>
      </header>
      <AdsReport
        workspaceId={link.workspaceId}
        provider={provider}
        label={providerLabel}
        range={range}
        preset={preset}
        sortKey={sortKey}
        sortDir={sortDir}
        page={page}
      />
    </>
  );
}
