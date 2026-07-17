"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, Link2, X } from "lucide-react";
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  type ShareLinkSummary,
} from "@/features/share/actions";
import { Badge, Button } from "@/components/ui/primitives";
import type { DemoProvider } from "@/features/demo-data/generator";

const inputCls =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

const PROVIDERS: Array<{ key: DemoProvider; label: string }> = [
  { key: "meta", label: "Meta Ads" },
  { key: "google_ads", label: "Google Ads" },
  { key: "tiktok", label: "TikTok Ads" },
];

const providerLabel = (key: string) => PROVIDERS.find((p) => p.key === key)?.label ?? key;

/**
 * Manage /share/:provider/:token links — the public, no-login access tier.
 * Create one per client + channel, copy the URL once (it's never shown
 * again), revoke any time. Scoped to whichever client workspace is
 * selected in this form, independent of the dashboard's own "ws" cookie.
 */
export function ShareLinksManager({
  workspaces,
}: {
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [provider, setProvider] = useState<DemoProvider>("meta");
  const [label, setLabel] = useState("");
  const [links, setLinks] = useState<ShareLinkSummary[]>([]);
  const [newUrl, setNewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh(ws: string) {
    startTransition(async () => {
      setLinks(await listShareLinks(ws));
    });
  }

  useEffect(() => {
    // Only re-fetch when the selected workspace changes.
    if (workspaceId) refresh(workspaceId);
  }, [workspaceId]);

  function create() {
    setError(null);
    setNewUrl(null);
    startTransition(async () => {
      const result = await createShareLink(workspaceId, provider, label);
      if (result.error || !result.url) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setNewUrl(
        typeof window !== "undefined" ? `${window.location.origin}${result.url}` : result.url,
      );
      setLabel("");
      refresh(workspaceId);
    });
  }

  function revoke(id: string) {
    startTransition(async () => {
      const result = await revokeShareLink(id, workspaceId);
      if (!result.error) refresh(workspaceId);
    });
  }

  function copy() {
    if (!newUrl) return;
    navigator.clipboard.writeText(newUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  if (workspaces.length === 0) {
    return (
      <p className="text-xs text-muted">Add a client workspace first to create share links.</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem]">
          <label className="mb-1 block text-xs text-muted">Client workspace</label>
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
        </div>
        <div className="min-w-[8rem]">
          <label className="mb-1 block text-xs text-muted">Channel</label>
          <select
            className={inputCls}
            value={provider}
            onChange={(e) => setProvider(e.target.value as DemoProvider)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[10rem] flex-1">
          <label className="mb-1 block text-xs text-muted">Label (optional)</label>
          <input
            className={inputCls}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Acme — monthly report"
          />
        </div>
        <Button disabled={pending || !workspaceId} onClick={create}>
          <Link2 size={13} /> Create link
        </Button>
      </div>

      {error ? <p className="text-xs text-negative">{error}</p> : null}
      {newUrl ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-positive/30 bg-positive/5 px-3 py-2 text-xs">
          <div className="min-w-0">
            <p className="font-medium text-positive">
              Share link created — copy it now, it won&apos;t be shown again.
            </p>
            <code className="mt-0.5 block truncate text-muted">{newUrl}</code>
          </div>
          <Button variant="outline" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      ) : null}

      <div className="space-y-1.5">
        {links.length === 0 ? (
          <p className="text-xs text-muted">No share links yet for this client.</p>
        ) : (
          links.map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px]"
            >
              <div>
                <span className="font-medium">{l.label ?? `${providerLabel(l.provider)} report`}</span>
                <p className="text-xs text-muted">
                  Created {new Date(l.createdAt).toLocaleDateString("en-IN")}
                  {l.lastViewedAt
                    ? ` · last viewed ${new Date(l.lastViewedAt).toLocaleDateString("en-IN")}`
                    : " · never viewed"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {l.revokedAt ? (
                  <Badge tone="outline">Revoked</Badge>
                ) : (
                  <>
                    <Badge tone="positive">Active</Badge>
                    <Button variant="outline" disabled={pending} onClick={() => revoke(l.id)}>
                      <X size={13} /> Revoke
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
