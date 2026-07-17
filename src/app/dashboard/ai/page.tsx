import { Topbar } from "@/components/shell/topbar";
import { Card, CardHeader, Badge } from "@/components/ui/primitives";
import { getAdDaily, getShopDaily, lastNDays, previousPeriod } from "@/features/metrics/queries";
import { getLiveMetaReport } from "@/features/integrations/meta-live";
import { adMetrics, blendedMetrics, sumAdFacts, sumShopFacts, type AdFacts } from "@/lib/metrics/definitions";
import { formatMoney, formatPercent } from "@/lib/utils";
import { getActiveWorkspaceId, getWorkspaceName } from "@/lib/workspace";
import { isDemoMode } from "@/lib/env";

export const metadata = { title: "AI Copilot" };

interface Insight {
  severity: "positive" | "negative" | "neutral";
  title: string;
  detail: string;
}

/**
 * Insight engine v0: statistical rules over the SAME metric definitions
 * the dashboards use. Phase 11 layers LLM narration + Q&A (OpenAI/Gemini
 * tool-calling) over these exact computations — the numbers never come
 * from the model.
 */
async function computeInsights(workspaceId: string): Promise<Insight[]> {
  const range = lastNDays(7);
  const prevRange = previousPeriod(range);
  // Meta is pulled live now (features/integrations/meta-live.ts) — the
  // database only carries Google/TikTok in live mode, so it's queried
  // separately here and merged in, same pattern as the Overview page.
  const dbProviders = isDemoMode
    ? (["meta", "google_ads", "tiktok"] as const)
    : (["google_ads", "tiktok"] as const);
  const [dbAds, prevDbAds, shop, prevShop, metaCurrent, metaPrevious] = await Promise.all([
    getAdDaily(workspaceId, range, [...dbProviders]),
    getAdDaily(workspaceId, prevRange, [...dbProviders]),
    getShopDaily(workspaceId, range),
    getShopDaily(workspaceId, prevRange),
    isDemoMode ? Promise.resolve(null) : getLiveMetaReport(workspaceId, range),
    isDemoMode ? Promise.resolve(null) : getLiveMetaReport(workspaceId, prevRange),
  ]);

  const insights: Insight[] = [];

  for (const provider of ["meta", "google_ads", "tiktok"] as const) {
    const now: AdFacts =
      provider === "meta"
        ? (metaCurrent?.totals ?? sumAdFacts([]))
        : sumAdFacts(dbAds.filter((a) => a.provider === provider));
    const before: AdFacts =
      provider === "meta"
        ? (metaPrevious?.totals ?? sumAdFacts([]))
        : sumAdFacts(prevDbAds.filter((a) => a.provider === provider));
    const roasNow = adMetrics.roas(now);
    const roasBefore = adMetrics.roas(before);
    if (roasBefore > 0) {
      const change = (roasNow - roasBefore) / roasBefore;
      const label = provider.replace("_", " ");
      if (change < -0.15) {
        insights.push({
          severity: "negative",
          title: `${label} ROAS down ${formatPercent(Math.abs(change))} week-over-week`,
          detail: `ROAS moved from ${roasBefore.toFixed(2)}x to ${roasNow.toFixed(2)}x while spend was ${formatMoney(now.spendMinor)}. Check creative fatigue and audience overlap before scaling further.`,
        });
      } else if (change > 0.15) {
        insights.push({
          severity: "positive",
          title: `${label} ROAS up ${formatPercent(change)} week-over-week`,
          detail: `ROAS improved to ${roasNow.toFixed(2)}x. If frequency (${adMetrics.frequency(now).toFixed(2)}) stays under ~2.5, this channel has scaling headroom.`,
        });
      }
    }
  }

  const shopNow = sumShopFacts(shop);
  const shopBefore = sumShopFacts(prevShop);
  const adsNow = sumAdFacts(metaCurrent ? [sumAdFacts(dbAds), metaCurrent.totals] : dbAds);
  const adsBefore = sumAdFacts(metaPrevious ? [sumAdFacts(prevDbAds), metaPrevious.totals] : prevDbAds);
  const merNow = blendedMetrics.mer(shopNow, adsNow);
  const merBefore = blendedMetrics.mer(shopBefore, adsBefore);
  if (merBefore > 0) {
    const change = (merNow - merBefore) / merBefore;
    insights.push({
      severity: change < -0.1 ? "negative" : change > 0.1 ? "positive" : "neutral",
      title: `Blended MER is ${merNow.toFixed(2)}x this week`,
      detail: `Net revenue ${formatMoney(shopNow.netSalesMinor)} against ${formatMoney(adsNow.spendMinor)} total ad spend (was ${merBefore.toFixed(2)}x last week).`,
    });
  }

  const revChange =
    shopBefore.netSalesMinor > 0
      ? (shopNow.netSalesMinor - shopBefore.netSalesMinor) / shopBefore.netSalesMinor
      : 0;
  insights.push({
    severity: revChange >= 0 ? "positive" : "negative",
    title: `Net revenue ${revChange >= 0 ? "up" : "down"} ${formatPercent(Math.abs(revChange))} week-over-week`,
    detail: `${formatMoney(shopNow.netSalesMinor)} this week vs ${formatMoney(shopBefore.netSalesMinor)} last week across ${shopNow.orders} orders.`,
  });

  return insights;
}

export default async function AiPage() {
  const workspaceId = await getActiveWorkspaceId();
  const insights = await computeInsights(workspaceId);
  const workspaceName = await getWorkspaceName(workspaceId);

  return (
    <>
      <Topbar title={`AI Copilot — ${workspaceName}`} />
      <main className="space-y-6 px-6 py-6">
        <Card>
          <CardHeader
            title="This week's signals"
            subtitle="Computed from your actual metrics — the same definitions every dashboard uses"
            action={<Badge tone="outline">Insight engine v0</Badge>}
          />
          <div className="space-y-3 px-5 pb-5 pt-2">
            {insights.map((insight) => (
              <div
                key={insight.title}
                className="rounded-lg border border-border px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={
                      insight.severity === "positive"
                        ? "h-1.5 w-1.5 rounded-full bg-positive"
                        : insight.severity === "negative"
                          ? "h-1.5 w-1.5 rounded-full bg-negative"
                          : "h-1.5 w-1.5 rounded-full bg-muted"
                    }
                  />
                  <p className="text-[13px] font-medium">{insight.title}</p>
                </div>
                <p className="mt-1 pl-3.5 text-xs leading-relaxed text-muted">
                  {insight.detail}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="px-5 py-4">
          <p className="text-[13px] font-medium">Ask anything (Phase 11)</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Natural-language Q&amp;A (&ldquo;Why did ROAS drop last week?&rdquo;) ships in the
            AI Engine phase: OpenAI/Gemini answer via tool-calling over these same
            metric functions — the model narrates, the database answers. Add
            OPENAI_API_KEY or GEMINI_API_KEY to enable it once that phase lands.
          </p>
        </Card>
      </main>
    </>
  );
}
