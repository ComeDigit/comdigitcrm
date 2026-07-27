import "server-only";
import { getDb } from "@/lib/db";
import { isDemoMode } from "@/lib/env";
import { resolveCreds, cached, reasonFor, logShopifyFailure, FACTS_TTL_MS } from "./shopify-live";
import { fetchShopifyProductFacts, type ShopifyProductFacts } from "./shopify";
import type { DateRange } from "@/features/metrics/queries";
import type { ShopifyFetchFailure } from "./shopify-live";

/**
 * On-demand orchestration for per-product Shopify sales
 * (AUDIT_REPORT.md — High: "Shopify product-level data missing"). Same
 * shape as getLiveShopifyReport in shopify-live.ts: resolve every active
 * Shopify connection under the workspace, pull each live (cached 60s per
 * connection+range), and surface partial failures instead of silently
 * dropping an unreachable store's numbers.
 *
 * Deliberately NOT merged/summed across connections the way daily
 * totals are — a Shopify product id is only unique WITHIN one store (it's
 * a per-shop sequential id, unlike Meta/Google's globally-assigned entity
 * ids), so two different connected stores could in principle have
 * unrelated products that happen to share a numeric id. Flat-concatenating
 * without merging (same as Meta's ad sets/ads) means the worst case for a
 * multi-store workspace is the same product name appearing twice, not two
 * unrelated products' revenue silently getting added together.
 */
export interface LiveShopifyProducts {
  products: ShopifyProductFacts[];
  partialFailure: boolean;
  failures: ShopifyFetchFailure[];
}

export async function getLiveShopifyProducts(workspaceId: string, range: DateRange): Promise<LiveShopifyProducts> {
  const empty: LiveShopifyProducts = { products: [], partialFailure: false, failures: [] };
  if (isDemoMode) return empty;

  const db = getDb();
  const connections = await db.query.integrationConnections.findMany({
    where: (c, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "shopify"), eqOp(c.status, "active")),
  });
  if (connections.length === 0) return empty;

  const failures: ShopifyFetchFailure[] = [];
  const perConnection = await Promise.all(
    connections.map(async (connection) => {
      const creds = await resolveCreds(connection);
      if (!creds) {
        const reason = "No access token available for this store — connect it in Settings.";
        failures.push({ displayName: connection.displayName, reason });
        logShopifyFailure(connection.displayName, new Error(reason));
        return null;
      }
      const cacheKey = `shopify-products:${connection.id}:${range.since}:${range.until}`;
      try {
        return await cached(cacheKey, FACTS_TTL_MS, () =>
          fetchShopifyProductFacts(creds.shopDomain, creds.accessToken, range),
        );
      } catch (e) {
        failures.push({ displayName: connection.displayName, reason: reasonFor(e) });
        logShopifyFailure(connection.displayName, e);
        return null;
      }
    }),
  );

  const lists = perConnection.filter((r): r is ShopifyProductFacts[] => r !== null);
  const products = lists.flat().sort((a, b) => b.revenueMinor - a.revenueMinor);

  return { products, partialFailure: failures.length > 0, failures };
}
