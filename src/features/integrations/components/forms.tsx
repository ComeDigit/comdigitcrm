"use client";

import { useActionState, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { connectMetaWithToken, type ActionResult } from "@/features/integrations/actions";
import { Button } from "@/components/ui/primitives";

const initial: ActionResult = {};

const inputCls =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Manual-token connect — an alternative to the OAuth "Connect" button for
 * when the app's domain/redirect config isn't cooperating yet. Paste an
 * access token (from Graph API Explorer or a System User) that already
 * has ads_read on the account; this verifies it against Meta before saving.
 */
export function ConnectMetaTokenForm({
  workspaces,
}: {
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(connectMetaWithToken, initial);

  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? <X size={13} /> : <KeyRound size={13} />} Use a token instead
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-96 rounded-xl border border-border bg-surface p-4 shadow-xl">
          <form action={formAction} className="space-y-2.5">
            <p className="text-xs leading-relaxed text-muted">
              Paste a Meta access token with <code className="rounded bg-surface-2 px-1">ads_read</code>{" "}
              permission on the ad account (from Graph API Explorer, or a
              System User token for something longer-lived). This skips the
              Facebook OAuth dialog entirely.
            </p>
            <select name="workspaceId" required className={inputCls} defaultValue="">
              <option value="" disabled>
                Client workspace…
              </option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <textarea
              name="accessToken"
              required
              rows={3}
              placeholder="EAAG..."
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {state.error ? <p className="text-xs text-negative">{state.error}</p> : null}
            {state.ok ? (
              <p className="text-xs text-positive">Connected — first sync queued.</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Verifying…" : "Connect with this token"}
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
