import "server-only";
import { getDb } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { isDemoMode } from "@/lib/env";
import { fetchShopifyDailyFacts } from "./shopify";
import { ProviderAuthError, ProviderRateLimitError } from "./types";
import { sumShopFacts, type ShopFacts } from "@/lib/metrics/definitions";
import type { DateRange } from "@/features/metrics/queries";

/**
 * On-demand Shopify reporting — same "pull-on-demand, not synced" shape as
 * meta-live.ts, adapted for store sales instead of ad spend. Nothing runs
 * in the background; when someone opens the Shopify page (or a workspace's
 * Overview/AI Copilot, which also blend in store numbers), this hits the
 * Shopify Admin API live for exactly that store + date range, cached 60s
 * per connection+range on the same warm server instance.
 */

interface CacheEntry<T> {
  expires: number;
  value: T;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.value as T;
  const value = await compute();
  cache.set(key, { expires: now + ttlMs, value });
  return value;
}

const FACTS_TTL_MS = 60_000;
const HEALTH_TTL_MS = 5 * 60_000;

function reasonFor(e: unknown): string {
  if (e instanceof ProviderAuthError) return "Shopify rejected the access token — it's likely been revoked. Reconnect in Settings.";
  if (e instanceof ProviderRateLimitError) return "Shopify rate-limited this request — try again in a minute.";
  if (e instanceof Error) return e.message;
  return "Unknown error reaching Shopify.";
}

function logShopifyFailure(connectionLabel: string, e: unknown): void {
  console.error(`[shopify-live] ${connectionLabel}: ${reasonFor(e)}`, e);
}

export interface ShopifyFetchFailure {
  displayName: string;
  reason: string;
}

export interface DailyShopPoint extends ShopFacts {
  date: string;
}

export interface LiveShopifyReport {
  totals: ShopFacts;
  rows: DailyShopPoint[];
  partialFailure: boolean;
  failures: ShopifyFetchFailure[];
}

interface ResolvedShopifyCreds {
  shopDomain: string;
  accessToken: string;
}

async function resolveCreds(connection: {
  id: string;
  externalAccountId: string;
}): Promise<ResolvedShopifyCreds | null> {
  const db = getDb();
  const secret = await db.query.integrationSecrets.findFirst({
    where: (s, { eq }) => eq(s.connectionId, connection.id),
  });
  if (!secret?.encryptedPayload) return null;
  const parsed = JSON.parse(decryptSecret(secret.encryptedPayload)) as { accessToken: string };
  return { shopDomain: connection.externalAccountId, accessToken: parsed.accessToken };
}

/**
 * Live store-sales report for every active Shopify connection under a
 * workspace, merged into one totals/rows set. Returns all-zero when
 * there's nothing to fetch (demo mode, or no active connection yet)
 * rather than erroring, so a brand-new client workspace just shows zeros.
 */
export async function getLiveShopifyReport(
  workspaceId: string,
  range: DateRange,
): Promise<LiveShopifyReport> {
  const empty: LiveShopifyReport = {
    totals: sumShopFacts([]),
    rows: [],
    partialFailure: false,
    failures: [],
  };
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
      const cacheKey = `shopify:${connection.id}:${range.since}:${range.until}`;
      try {
        return await cached(cacheKey, FACTS_TTL_MS, () =>
          fetchShopifyDailyFacts(creds.shopDomain, creds.accessToken, range),
        );
      } catch (e) {
        failures.push({ displayName: connection.displayName, reason: reasonFor(e) });
        logShopifyFailure(connection.displayName, e);
        return null;
      }
    }),
  );

  const maps = perConnection.filter((m): m is Map<string, ShopFacts> => m !== null);

  const merged = new Map<string, ShopFacts>();
  for (const map of maps) {
    for (const [date, facts] of map) {
      const existing = merged.get(date);
      merged.set(date, existing ? sumShopFacts([existing, facts]) : facts);
    }
  }

  const rows: DailyShopPoint[] = [...merged.entries()]
    .map(([date, facts]) => ({ date, ...facts }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totals: sumShopFacts(rows),
    rows,
    partialFailure: failures.length > 0,
    failures,
  };
}

export type ShopifyAccountHealth = "live" | "idle" | "no_access";

export interface ShopifyAccountHealthResult {
  connectionId: string;
  displayName: string;
  health: ShopifyAccountHealth;
}

/**
 * Cheap per-connection health probe — mirrors checkMetaAccountsHealth.
 * "live" = reachable with orders in the last week, "idle" = reachable but
 * no recent orders, "no_access" = token rejected.
 */
export async function checkShopifyAccountsHealth(workspaceId: string): Promise<ShopifyAccountHealthResult[]> {
  if (isDemoMode) return [];

  const db = getDb();
  const connections = await db.query.integrationConnections.findMany({
    where: (c, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(c.workspaceId, workspaceId), eqOp(c.provider, "shopify")),
  });
  if (connections.length === 0) return [];

  const until = new Date();
  const since = new Date();
  since.setDate(until.getDate() - 6);
  const range: DateRange = { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10) };

  return Promise.all(
    connections.map(async (connection) => {
      const cacheKey = `shopify-health:${connection.id}`;
      const health = await cached<ShopifyAccountHealth>(cacheKey, HEALTH_TTL_MS, async () => {
        const creds = await resolveCreds(connection);
        if (!creds) return "no_access";
        try {
          const facts = await fetchShopifyDailyFacts(creds.shopDomain, creds.accessToken, range);
          const orders = [...facts.values()].reduce((sum, f) => sum + f.orders, 0);
          return orders > 0 ? "live" : "idle";
        } catch (e) {
          logShopifyFailure(connection.displayName, e);
          return "no_access";
        }
      });
      return { connectionId: connection.id, displayName: connection.displayName, health };
    }),
  );
}
