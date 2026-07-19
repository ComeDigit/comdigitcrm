"use client";

import { useState, useTransition } from "react";
import { Building2, KeyRound, Sparkles, X } from "lucide-react";
import {
  previewMetaAccessToken,
  connectMetaAccounts,
  previewAgencyMetaAccounts,
  connectAgencyMetaAccounts,
  autoProvisionAgencyMetaAccounts,
  type MetaAccountPreview,
} from "@/features/integrations/actions";
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
