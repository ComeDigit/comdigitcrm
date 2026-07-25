import { Card, CardHeader, Badge } from "@/components/ui/primitives";
import { getAdDaily, getShopDaily, lastNDays, previousPeriod } from "@/features/metrics/queries";
import {
  getLiveAdsReport,
  adsReportFromRows,
  AD_PROVIDER_KEYS,
  AD_PROVIDER_LABELS,
  type LiveAdsReport,
} from "@/features/integrations/live-ads";
import { getLiveShopifyReport } from "@/features/integrations/shopify-live";
import { adMetrics, blendedMetrics, sumShopFacts, type ShopFacts } from "@/lib/metrics/definitions";
import { formatMoney, formatPercent } from "@/lib/utils";
import { isDemoMode } from "@/lib/env";

interface Insight {
  severity: "positive" | "negative" | "neutral";
  title: string;
  detail: string;
}

interface InsightsResult {
  insights: Insight[];
  failures: Array<{ channel: string; displayName: string; reason: string }>;
}

/**
 * Insight engine v0: statistical rules over the SAME metric definitions
 * the dashboards use. Phase 11 layers LLM narration + Q&A (OpenAI/Gemini
 * tool-calling) over these exact computations — the numbers never come
 * from the model.
 */
async function computeInsights(workspaceId: string): Promise<InsightsResult> {
  const range = lastNDays(7);
  const prevRange = previousPeriod(range);

  // Ads (Meta/Google Ads/TikTok) and Shopify are both pulled live now (see
  // features/integrations/live-ads.ts and shopify-live.ts) — nothing syncs
  // to the database anymore. Demo mode keeps reading the deterministic
  // generator for both, reshaped into the same LiveAdsReport shape via
  // adsReportFromRows — same branching as OverviewReport/ShopifyReport.
  let ads: LiveAdsReport;
  let adsPrev: LiveAdsReport;
  let shopNow: ShopFacts;
  let shopBefore: ShopFacts;
  let failures: Array<{ channel: string; displayName: string; reason: string }> = [];

  if (!isDemoMode) {
    const [adsCurrent, adsPrevious, shopCurrent, shopPrevious] = await Promise.all([
      getLiveAdsReport(workspaceId, range),
      getLiveAdsReport(workspaceId, prevRange),
      getLiveShopifyReport(workspaceId, range),
      getLiveShopifyReport(workspaceId, prevRange),
    ]);
    ads = adsCurrent;
    adsPrev = adsPrevious;
    shopNow = sumShopFacts(shopCurrent.rows);
    shopBefore = sumShopFacts(shopPrevious.rows);
    // Only current-period failures are shown — the previous-period pull
    // uses the same connections/credentials, so its failures would just
    // repeat the same reason (same call as ShopifyReport makes).
    failures = [
      ...adsCurrent.failures.map((f) => ({
        channel: AD_PROVIDER_LABELS[f.provider],
        displayName: f.displayName,
        reason: f.reason,
      })),
      ...shopCurrent.failures.map((f) => ({ channel: "Shopify", displayName: f.displayName, reason: f.reason })),
    ];
  } else {
    const [dbAds, prevDbAds, shopRows, prevShopRows] = await Promise.all([
      getAdDaily(workspaceId, range, [...AD_PROVIDER_KEYS]),
      getAdDaily(workspaceId, prevRange, [...AD_PROVIDER_KEYS]),
      getShopDaily(workspaceId, range),
      getShopDaily(workspaceId, prevRange),
    ]);
    ads = adsReportFromRows(dbAds);
    adsPrev = adsReportFromRows(prevDbAds);
    shopNow = sumShopFacts(shopRows);
    shopBefore = sumShopFacts(prevShopRows);
  }

  const insights: Insight[] = [];

  for (const provider of AD_PROVIDER_KEYS) {
    // Skip a provider whose current- or previous-period pull failed — its
    // totals are zeroed/partial, so a "ROAS down 100%" reading would be an
    // artifact of the failed fetch, not a real performance change.
    const failed =
      ads.failures.some((f) => f.provider === provider) ||
      adsPrev.failures.some((f) => f.provider === provider);
    if (failed) continue;

    const now = ads.byProvider[provider].totals;
    const before = adsPrev.byProvider[provider].totals;
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

  const merNow = blendedMetrics.mer(shopNow, ads.totals);
  const merBefore = blendedMetrics.mer(shopBefore, adsPrev.totals);
  if (merBefore > 0) {
    const change = (merNow - merBefore) / merBefore;
    insights.push({
      severity: change < -0.1 ? "negative" : change > 0.1 ? "positive" : "neutral",
      title: `Blended MER is ${merNow.toFixed(2)}x this week`,
      detail: `Net revenue ${formatMoney(shopNow.netSalesMinor)} against ${formatMoney(ads.totals.spendMinor)} total ad spend (was ${merBefore.toFixed(2)}x last week).`,
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

  return { insights, failures };
}

/**
 * The read-only AI Copilot body — computed insight cards — with NO Topbar.
 * Takes workspaceId explicitly, same split as OverviewReport/ShopifyReport,
 * so it renders identically on the internal dashboard route and the client
 * portal's own AI Copilot page.
 */
export async function AiInsights({ workspaceId }: { workspaceId: string }) {
  const { insights, failures } = await computeInsights(workspaceId);

  return (
    <>
      {failures.length > 0 ? (
        <div className="rounded-lg border border-negative/30 bg-negative/10 px-4 py-2.5 text-xs text-negative">
          <p>
            Signals below may be incomplete — couldn&apos;t reach{" "}
            {failures.length === 1 ? "1 connected account" : `${failures.length} connected accounts`} just
            now, so that channel&apos;s signals are sitting out this pass. Refreshing may resolve it.
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {failures.map((f, i) => (
              <li key={`${f.channel}-${f.displayName}-${i}`}>
                <span className="font-medium">{f.channel} · {f.displayName}:</span> {f.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
    </>
  );
}
