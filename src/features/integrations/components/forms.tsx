"use client";

import { useState, useTransition } from "react";
import { Building2, KeyRound, Music2, Search, ShoppingBag, Sparkles, X } from "lucide-react";
import {
  previewMetaAccessToken,
  connectMetaAccounts,
  previewAgencyMetaAccounts,
  connectAgencyMetaAccounts,
  autoProvisionAgencyMetaAccounts,
  previewShopifyStore,
  connectShopifyStore,
  previewAgencyGoogleAdsAccounts,
  connectAgencyGoogleAdsAccounts,
  previewTikTokAccessToken,
  connectTikTokAccounts,
  disconnectConnection,
  type MetaAccountPreview,
  type GoogleAdsAccountPreview,
  type TikTokAccountPreview,
} from "@/features/integrations/actions";
import type { ShopifyShopInfo } from "@/features/integrations/shopify";
import { Button } from "@/components/ui/primitives";

const inputCls =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Manual-token connect — an alternative to the OAuth "Connect" button for
 * when the app's domain/redirect config isn't cooperating yet. Two steps:
 * paste a token → pick which of its ad accounts to connect (a Business can
 * have several) and which client each one belongs to.
 */
export function ConnectMetaTokenForm({
  workspaces,
}: {
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [accounts, setAccounts] = useState<MetaAccountPreview[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [workspaceFor, setWorkspaceFor] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setAccounts(null);
    setChecked({});
    setWorkspaceFor({});
    setError(null);
    setSuccess(null);
    setToken("");
  }

  function fetchAccounts() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await previewMetaAccessToken(token);
      if (result.error || !result.accounts) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setAccounts(result.accounts);
      const defaults: Record<string, string> = {};
      for (const a of result.accounts) defaults[a.accountId] = workspaces[0]?.id ?? "";
      setWorkspaceFor(defaults);
    });
  }

  function connectSelected() {
    setError(null);
    const selectedIds = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (selectedIds.length === 0) {
      setError("Pick at least one ad account.");
      return;
    }
    startTransition(async () => {
      const selections = (accounts ?? [])
        .filter((a) => selectedIds.includes(a.accountId))
        .map((a) => ({ ...a, workspaceId: workspaceFor[a.accountId] ?? "" }));
      const result = await connectMetaAccounts(token, selections);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(
        `Connected ${selections.length} ad account${selections.length === 1 ? "" : "s"} — first sync queued.`,
      );
      setAccounts(null);
      setChecked({});
    });
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        onClick={() => {
          setOpen((v) => !v);
          if (open) reset();
        }}
      >
        {open ? <X size={13} /> : <KeyRound size={13} />} Use a token instead
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[26rem] rounded-xl border border-border bg-surface p-4 shadow-xl">
          {!accounts ? (
            <div className="space-y-2.5">
              <p className="text-xs leading-relaxed text-muted">
                Paste a Meta access token with{" "}
                <code className="rounded bg-surface-2 px-1">ads_read</code> permission. If your
                Business has several ad accounts, we&apos;ll list all of them so you can pick which
                to connect.
              </p>
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                rows={3}
                placeholder="EAAG..."
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {error ? <p className="text-xs text-negative">{error}</p> : null}
              <Button
                className="w-full"
                disabled={pending || token.trim().length < 20}
                onClick={fetchAccounts}
              >
                {pending ? "Checking…" : "Fetch ad accounts"}
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-muted">
                Found {accounts.length} ad account{accounts.length === 1 ? "" : "s"}. Pick which to
                connect and which client each belongs to.
              </p>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {accounts.map((a) => (
                  <div key={a.accountId} className="rounded-lg border border-border px-3 py-2">
                    <label className="flex items-center gap-2 text-[13px] font-medium">
                      <input
                        type="checkbox"
                        checked={Boolean(checked[a.accountId])}
                        onChange={(e) =>
                          setChecked((prev) => ({ ...prev, [a.accountId]: e.target.checked }))
                        }
                      />
                      {a.name}
                      <span className="text-xs font-normal text-muted">({a.currency})</span>
                    </label>
                    <select
                      className={`${inputCls} mt-1.5`}
                      value={workspaceFor[a.accountId] ?? ""}
                      onChange={(e) =>
                        setWorkspaceFor((prev) => ({ ...prev, [a.accountId]: e.target.value }))
                      }
                    >
                      <option value="" disabled>
                        Client workspace…
                      </option>
                      {workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {error ? <p className="text-xs text-negative">{error}</p> : null}
              {success ? <p className="text-xs text-positive">{success}</p> : null}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setAccounts(null)}>
                  Back
                </Button>
                <Button className="flex-1" disabled={pending} onClick={connectSelected}>
                  {pending ? "Connecting…" : "Connect selected"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Agency-token connect — sources credentials from the server-only
 * META_USER_TOKEN env var instead of a pasted value, so no secret ever
 * touches the browser. Deliberately does not save a per-connection secret;
 * sync.ts falls back to the shared token for any connection created here,
 * which is what lets it coexist with per-client paste-a-token connections.
 */
export function ConnectMetaAgencyForm({
  workspaces,
}: {
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<MetaAccountPreview[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [workspaceFor, setWorkspaceFor] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setAccounts(null);
    setChecked({});
    setWorkspaceFor({});
    setError(null);
    setSuccess(null);
  }

  function fetchAccounts() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await previewAgencyMetaAccounts();
      if (result.error || !result.accounts) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setAccounts(result.accounts);
      const defaults: Record<string, string> = {};
      for (const a of result.accounts) defaults[a.accountId] = workspaces[0]?.id ?? "";
      setWorkspaceFor(defaults);
    });
  }

  function connectSelected() {
    setError(null);
    const selectedIds = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (selectedIds.length === 0) {
      setError("Pick at least one ad account.");
      return;
    }
    startTransition(async () => {
      const selections = (accounts ?? [])
        .filter((a) => selectedIds.includes(a.accountId))
        .map((a) => ({ ...a, workspaceId: workspaceFor[a.accountId] ?? "" }));
      const result = await connectAgencyMetaAccounts(selections);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(
        `Connected ${selections.length} ad account${selections.length === 1 ? "" : "s"} under the agency token — first sync queued.`,
      );
      setAccounts(null);
      setChecked({});
    });
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        onClick={() => {
          setOpen((v) => !v);
          if (open) reset();
        }}
      >
        {open ? <X size={13} /> : <Building2 size={13} />} Use agency token
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[26rem] rounded-xl border border-border bg-surface p-4 shadow-xl">
          {!accounts ? (
            <div className="space-y-2.5">
              <p className="text-xs leading-relaxed text-muted">
                Connect ad accounts using the shared agency-wide token (from the{" "}
                <code className="rounded bg-surface-2 px-1">META_USER_TOKEN</code> environment
                variable) instead of pasting a token per client. We&apos;ll list every ad account
                this token can see so you can pick which to connect.
              </p>
              {error ? <p className="text-xs text-negative">{error}</p> : null}
              <Button className="w-full" disabled={pending} onClick={fetchAccounts}>
                {pending ? "Checking…" : "Fetch ad accounts"}
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-muted">
                Found {accounts.length} ad account{accounts.length === 1 ? "" : "s"}. Pick which to
                connect and which client each belongs to.
              </p>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {accounts.map((a) => (
                  <div key={a.accountId} className="rounded-lg border border-border px-3 py-2">
                    <label className="flex items-center gap-2 text-[13px] font-medium">
                      <input
                        type="checkbox"
                        checked={Boolean(checked[a.accountId])}
                        onChange={(e) =>
                          setChecked((prev) => ({ ...prev, [a.accountId]: e.target.checked }))
                        }
                      />
                      {a.name}
                      <span className="text-xs font-normal text-muted">({a.currency})</span>
                    </label>
                    <select
                      className={`${inputCls} mt-1.5`}
                      value={workspaceFor[a.accountId] ?? ""}
                      onChange={(e) =>
                        setWorkspaceFor((prev) => ({ ...prev, [a.accountId]: e.target.value }))
                      }
                    >
                      <option value="" disabled>
                        Client workspace…
                      </option>
                      {workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {error ? <p className="text-xs text-negative">{error}</p> : null}
              {success ? <p className="text-xs text-positive">{success}</p> : null}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setAccounts(null)}>
                  Back
                </Button>
                <Button className="flex-1" disabled={pending} onClick={connectSelected}>
                  {pending ? "Connecting…" : "Connect selected"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One click, one client per Meta ad account. Meta's Business portfolio
 * becomes the source of truth for who your clients are — every ad account
 * the agency token can see gets its own workspace, named after the ad
 * account, with no manual "which client does this belong to" step. Safe to
 * click again later: accounts already connected to a workspace are left
 * alone, so it only ever picks up newly added ad accounts.
 */
export function AutoProvisionMetaAccountsButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const result = await autoProvisionAgencyMetaAccounts();
      if (result.error) {
        setError(result.error);
        return;
      }
      const parts: string[] = [];
      if (result.createdWorkspaces) {
        parts.push(
          `created ${result.createdWorkspaces} new client workspace${result.createdWorkspaces === 1 ? "" : "s"}`,
        );
      }
      if (result.skippedAccounts) {
        parts.push(
          `${result.skippedAccounts} ad account${result.skippedAccounts === 1 ? " was" : "s were"} already connected`,
        );
      }
      setSummary(
        parts.length > 0
          ? `Done — ${parts.join(", ")}.`
          : "Done — no ad accounts found on this token.",
      );
    });
  }

  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? <X size={13} /> : <Sparkles size={13} />} Auto-create clients from Meta
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-96 rounded-xl border border-border bg-surface p-4 shadow-xl">
          <div className="space-y-2.5">
            <p className="text-xs leading-relaxed text-muted">
              Scans every ad account the agency token (
              <code className="rounded bg-surface-2 px-1">META_USER_TOKEN</code>) can see and
              creates a client workspace for each one that doesn&apos;t already have one —
              named and connected automatically, nothing to pick by hand. Existing clients are
              left exactly as they are.
            </p>
            {error ? <p className="text-xs text-negative">{error}</p> : null}
            {summary ? <p className="text-xs text-positive">{summary}</p> : null}
            <Button className="w-full" disabled={pending} onClick={run}>
              {pending ? "Working…" : "Run auto-create"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Cuts a single connected account off — the counterpart to every connect
 * flow above. Previously there was no way to do this at all short of
 * editing the database by hand. Reversible: reconnecting through the
 * normal flow (with valid credentials) brings it back to active.
 */
export function DisconnectConnectionButton({
  connectionId,
  workspaceId,
}: {
  connectionId: string;
  workspaceId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await disconnectConnection(connectionId, workspaceId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(true);
    });
  }

  if (done) return <span className="text-xs text-muted">Disconnected</span>;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={run}
      title={error ?? undefined}
      className="text-xs font-medium text-muted underline-offset-4 hover:text-negative hover:underline disabled:opacity-50"
    >
      {pending ? "…" : "Disconnect"}
    </button>
  );
}

/**
 * Shopify connect — paste a shop domain + Admin API access token from a
 * custom app created directly in that store's admin (see the Settings
 * page copy for the exact steps). Mirrors ConnectMetaTokenForm's two-step
 * shape: preview (verify + show the shop name back) then connect (save).
 */
export function ConnectShopifyForm({
  workspaces,
}: {
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [shopDomain, setShopDomain] = useState("");
  const [token, setToken] = useState("");
  const [shopInfo, setShopInfo] = useState<ShopifyShopInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setShopDomain("");
    setToken("");
    setShopInfo(null);
    setError(null);
    setSuccess(null);
  }

  function verify() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await previewShopifyStore(shopDomain, token);
      if (result.error || !result.shop) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setShopInfo(result.shop);
    });
  }

  function connect() {
    setError(null);
    if (!workspaceId) {
      setError("Pick a client workspace.");
      return;
    }
    startTransition(async () => {
      const result = await connectShopifyStore(workspaceId, shopDomain, token);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(`Connected ${shopInfo?.name ?? "the store"} — orders start pulling live immediately.`);
      setShopInfo(null);
      setToken("");
    });
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        onClick={() => {
          setOpen((v) => !v);
          if (open) reset();
        }}
      >
        {open ? <X size={13} /> : <ShoppingBag size={13} />} Connect a store
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-96 rounded-xl border border-border bg-surface p-4 shadow-xl">
          {!shopInfo ? (
            <div className="space-y-2.5">
              <p className="text-xs leading-relaxed text-muted">
                Already have an Admin API access token for this store (from an existing
                custom app, or one minted another way)? Paste it below — it starts with{" "}
                <code className="rounded bg-surface-2 px-1">shpat_</code>. Setting up a brand
                new store? The &quot;Connect via OAuth&quot; button is the easier path now —
                Shopify moved custom-app creation to the Dev Dashboard, so there&apos;s no
                longer a one-click way to get a token straight from a store&apos;s own admin.
              </p>
              <div>
                <label className="mb-1 block text-xs text-muted">Shop domain</label>
                <input
                  className={inputCls}
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  placeholder="yourstore.myshopify.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Admin API access token</label>
                <textarea
                  className={`${inputCls} h-20 py-2`}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="shpat_..."
                />
              </div>
              {error ? <p className="text-xs text-negative">{error}</p> : null}
              {success ? <p className="text-xs text-positive">{success}</p> : null}
              <Button className="w-full" disabled={pending || !shopDomain || !token} onClick={verify}>
                {pending ? "Checking…" : "Verify store"}
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-muted">
                Found <span className="font-medium text-foreground">{shopInfo.name}</span> (
                {shopInfo.currency}). Pick which client this store belongs to.
              </p>
              <select
                className={inputCls}
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              {error ? <p className="text-xs text-negative">{error}</p> : null}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShopInfo(null)}>
                  Back
                </Button>
                <Button className="flex-1" disabled={pending || !workspaceId} onClick={connect}>
                  {pending ? "Connecting…" : "Connect store"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * OAuth "Connect" for Shopify — the recommended path now that Shopify has
 * retired in-admin custom-app creation (see the paste-a-token form's
 * copy). Unlike Meta/Google Ads/TikTok, Shopify's consent dialog lives on
 * the STORE's own domain rather than one fixed URL, so this needs a shop
 * domain up front. A plain GET form straight to the start route is enough
 * — no client-side preview step, Shopify's own consent screen (and the
 * callback's HMAC verification) is what proves the connection is real.
 * Connects to whichever workspace is currently active in the top nav —
 * same convention as the plain OAuth anchor Meta/Google Ads/TikTok use.
 */
export function ConnectShopifyOAuthForm({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [shop, setShop] = useState("");

  return (
    <div className="relative">
      <Button
        variant="outline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X size={13} /> : <ShoppingBag size={13} />} Connect via OAuth
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-border bg-surface p-4 shadow-xl">
          <form action="/api/integrations/shopify/start" method="GET" className="space-y-2.5">
            <p className="text-xs leading-relaxed text-muted">
              Enter the client&apos;s store domain. You&apos;ll be sent to Shopify to approve
              access for the currently-active workspace, then back here, connected.
            </p>
            <input type="hidden" name="workspace" value={workspaceId} />
            <div>
              <label className="mb-1 block text-xs text-muted">Shop domain</label>
              <input
                className={inputCls}
                name="shop"
                value={shop}
                onChange={(e) => setShop(e.target.value)}
                placeholder="yourstore.myshopify.com"
                required
              />
            </div>
            <Button className="w-full" type="submit" disabled={!shop.trim()}>
              Continue to Shopify
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Google Ads agency-token connect — mirrors ConnectMetaAgencyForm, sourced
 * from GOOGLE_ADS_REFRESH_TOKEN + GOOGLE_ADS_LOGIN_CUSTOMER_ID (the
 * agency's own MCC) instead of a single long-lived token. Lists every
 * client account linked one level under that MCC so an admin can pick
 * which workspace each belongs to — no per-client OAuth consent needed.
 * This is the recommended way to connect Google Ads for most clients; the
 * plain "Connect" OAuth button next to it is for the rarer case of a
 * client granting direct access to their own account outside the agency's
 * MCC.
 */
export function ConnectGoogleAdsAgencyForm({
  workspaces,
}: {
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<GoogleAdsAccountPreview[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [workspaceFor, setWorkspaceFor] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setAccounts(null);
    setChecked({});
    setWorkspaceFor({});
    setError(null);
    setSuccess(null);
  }

  function fetchAccounts() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await previewAgencyGoogleAdsAccounts();
      if (result.error || !result.accounts) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setAccounts(result.accounts);
      const defaults: Record<string, string> = {};
      for (const a of result.accounts) defaults[a.customerId] = workspaces[0]?.id ?? "";
      setWorkspaceFor(defaults);
    });
  }

  function connectSelected() {
    setError(null);
    const selectedIds = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (selectedIds.length === 0) {
      setError("Pick at least one account.");
      return;
    }
    startTransition(async () => {
      const selections = (accounts ?? [])
        .filter((a) => selectedIds.includes(a.customerId))
        .map((a) => ({ ...a, workspaceId: workspaceFor[a.customerId] ?? "" }));
      const result = await connectAgencyGoogleAdsAccounts(selections);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(
        `Connected ${selections.length} account${selections.length === 1 ? "" : "s"} under the agency token.`,
      );
      setAccounts(null);
      setChecked({});
    });
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        onClick={() => {
          setOpen((v) => !v);
          if (open) reset();
        }}
      >
        {open ? <X size={13} /> : <Search size={13} />} Use agency token
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[26rem] rounded-xl border border-border bg-surface p-4 shadow-xl">
          {!accounts ? (
            <div className="space-y-2.5">
              <p className="text-xs leading-relaxed text-muted">
                Connect client accounts linked under the agency&apos;s Google Ads manager (MCC)
                account, using the shared{" "}
                <code className="rounded bg-surface-2 px-1">GOOGLE_ADS_REFRESH_TOKEN</code>{" "}
                instead of a per-client OAuth consent. We&apos;ll list every client account linked
                one level under{" "}
                <code className="rounded bg-surface-2 px-1">GOOGLE_ADS_LOGIN_CUSTOMER_ID</code> so
                you can pick which to connect.
              </p>
              {error ? <p className="text-xs text-negative">{error}</p> : null}
              <Button className="w-full" disabled={pending} onClick={fetchAccounts}>
                {pending ? "Checking…" : "Fetch client accounts"}
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-muted">
                Found {accounts.length} account{accounts.length === 1 ? "" : "s"}. Pick which to
                connect and which client each belongs to.
              </p>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {accounts.map((a) => (
                  <div key={a.customerId} className="rounded-lg border border-border px-3 py-2">
                    <label className="flex items-center gap-2 text-[13px] font-medium">
                      <input
                        type="checkbox"
                        checked={Boolean(checked[a.customerId])}
                        onChange={(e) =>
                          setChecked((prev) => ({ ...prev, [a.customerId]: e.target.checked }))
                        }
                      />
                      {a.name}
                      <span className="text-xs font-normal text-muted">({a.currency})</span>
                    </label>
                    <select
                      className={`${inputCls} mt-1.5`}
                      value={workspaceFor[a.customerId] ?? ""}
                      onChange={(e) =>
                        setWorkspaceFor((prev) => ({ ...prev, [a.customerId]: e.target.value }))
                      }
                    >
                      <option value="" disabled>
                        Client workspace…
                      </option>
                      {workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {error ? <p className="text-xs text-negative">{error}</p> : null}
              {success ? <p className="text-xs text-positive">{success}</p> : null}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setAccounts(null)}>
                  Back
                </Button>
                <Button className="flex-1" disabled={pending} onClick={connectSelected}>
                  {pending ? "Connecting…" : "Connect selected"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * TikTok manual-token connect — mirrors ConnectMetaTokenForm exactly.
 * Recommended over the OAuth "Connect" button for connecting more than one
 * account at once, since TikTok's token-exchange response only ever
 * returns however many accounts were granted on TikTok's own consent
 * screen — this form's picker handles any number cleanly either way.
 */
export function ConnectTikTokTokenForm({
  workspaces,
}: {
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [accounts, setAccounts] = useState<TikTokAccountPreview[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [workspaceFor, setWorkspaceFor] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setAccounts(null);
    setChecked({});
    setWorkspaceFor({});
    setError(null);
    setSuccess(null);
    setToken("");
  }

  function fetchAccounts() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await previewTikTokAccessToken(token);
      if (result.error || !result.accounts) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setAccounts(result.accounts);
      const defaults: Record<string, string> = {};
      for (const a of result.accounts) defaults[a.advertiserId] = workspaces[0]?.id ?? "";
      setWorkspaceFor(defaults);
    });
  }

  function connectSelected() {
    setError(null);
    const selectedIds = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (selectedIds.length === 0) {
      setError("Pick at least one ad account.");
      return;
    }
    startTransition(async () => {
      const selections = (accounts ?? [])
        .filter((a) => selectedIds.includes(a.advertiserId))
        .map((a) => ({ ...a, workspaceId: workspaceFor[a.advertiserId] ?? "" }));
      const result = await connectTikTokAccounts(token, selections);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(
        `Connected ${selections.length} ad account${selections.length === 1 ? "" : "s"} — reports pull live immediately.`,
      );
      setAccounts(null);
      setChecked({});
    });
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        onClick={() => {
          setOpen((v) => !v);
          if (open) reset();
        }}
      >
        {open ? <X size={13} /> : <Music2 size={13} />} Use a token instead
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[26rem] rounded-xl border border-border bg-surface p-4 shadow-xl">
          {!accounts ? (
            <div className="space-y-2.5">
              <p className="text-xs leading-relaxed text-muted">
                Paste a TikTok Business API access token (from the TikTok for Business developer
                portal, scoped to Reporting access). If it can reach several ad accounts,
                we&apos;ll list all of them so you can pick which to connect.
              </p>
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                rows={3}
                placeholder="act..."
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {error ? <p className="text-xs text-negative">{error}</p> : null}
              <Button
                className="w-full"
                disabled={pending || token.trim().length < 10}
                onClick={fetchAccounts}
              >
                {pending ? "Checking…" : "Fetch ad accounts"}
              </Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-muted">
                Found {accounts.length} ad account{accounts.length === 1 ? "" : "s"}. Pick which to
                connect and which client each belongs to.
              </p>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {accounts.map((a) => (
                  <div key={a.advertiserId} className="rounded-lg border border-border px-3 py-2">
                    <label className="flex items-center gap-2 text-[13px] font-medium">
                      <input
                        type="checkbox"
                        checked={Boolean(checked[a.advertiserId])}
                        onChange={(e) =>
                          setChecked((prev) => ({ ...prev, [a.advertiserId]: e.target.checked }))
                        }
                      />
                      {a.name}
                      <span className="text-xs font-normal text-muted">({a.currency})</span>
                    </label>
                    <select
                      className={`${inputCls} mt-1.5`}
                      value={workspaceFor[a.advertiserId] ?? ""}
                      onChange={(e) =>
                        setWorkspaceFor((prev) => ({ ...prev, [a.advertiserId]: e.target.value }))
                      }
                    >
                      <option value="" disabled>
                        Client workspace…
                      </option>
                      {workspaces.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {error ? <p className="text-xs text-negative">{error}</p> : null}
              {success ? <p className="text-xs text-positive">{success}</p> : null}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setAccounts(null)}>
                  Back
                </Button>
                <Button className="flex-1" disabled={pending} onClick={connectSelected}>
                  {pending ? "Connecting…" : "Connect selected"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
