"use client";

import { useEffect, useState, useTransition } from "react";
import { KeyRound, Power, Trash2 } from "lucide-react";
import {
  getClientLogin,
  saveClientLogin,
  setClientLoginStatus,
  deleteClientLogin,
  type ClientLoginSummary,
} from "@/features/client-portal/actions";
import { Badge, Button } from "@/components/ui/primitives";

const inputCls =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Manage the ONE client login per workspace — the login-based portal at
 * /client, alongside (not replacing) the public share-link tier above.
 * The admin chooses username + password directly (not auto-generated, per
 * client's explicit preference); the password is only ever typed here and
 * hashed server-side — this component never sees or stores it afterward.
 */
export function ClientPortalManager({
  workspaces,
}: {
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [login, setLogin] = useState<ClientLoginSummary | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh(ws: string) {
    startTransition(async () => {
      const existing = await getClientLogin(ws);
      setLogin(existing);
      setUsername(existing?.username ?? "");
      setPassword("");
    });
  }

  useEffect(() => {
    if (workspaceId) refresh(workspaceId);
  }, [workspaceId]);

  function save() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await saveClientLogin(workspaceId, username, password);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(login ? "Login updated." : "Login created.");
      setPassword("");
      refresh(workspaceId);
    });
  }

  function toggleStatus() {
    if (!login) return;
    const next = login.status === "active" ? "disabled" : "active";
    startTransition(async () => {
      const result = await setClientLoginStatus(login.id, workspaceId, next);
      if (!result.error) refresh(workspaceId);
    });
  }

  function remove() {
    if (!login) return;
    startTransition(async () => {
      const result = await deleteClientLogin(login.id, workspaceId);
      if (!result.error) refresh(workspaceId);
    });
  }

  if (workspaces.length === 0) {
    return (
      <p className="text-xs text-muted">Add a client workspace first to create a client login.</p>
    );
  }

  return (
    <div className="space-y-4">
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

      {login ? (
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px]">
          <div>
            <span className="font-medium">{login.username}</span>
            <p className="text-xs text-muted">
              {login.lastLoginAt
                ? `Last login ${new Date(login.lastLoginAt).toLocaleString("en-IN")}`
                : "Never logged in"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={login.status === "active" ? "positive" : "outline"}>
              {login.status === "active" ? "Active" : "Disabled"}
            </Badge>
            <Button variant="outline" disabled={pending} onClick={toggleStatus}>
              <Power size={13} /> {login.status === "active" ? "Disable" : "Enable"}
            </Button>
            <Button variant="outline" disabled={pending} onClick={remove}>
              <Trash2 size={13} /> Delete
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">No client login yet for this workspace.</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem]">
          <label className="mb-1 block text-xs text-muted">Username</label>
          <input
            className={inputCls}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. acme-client"
            autoComplete="off"
          />
        </div>
        <div className="min-w-[10rem]">
          <label className="mb-1 block text-xs text-muted">Password</label>
          <input
            className={inputCls}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
        </div>
        <Button disabled={pending || !workspaceId} onClick={save}>
          <KeyRound size={13} /> {login ? "Update login" : "Create login"}
        </Button>
      </div>

      {error ? <p className="text-xs text-negative">{error}</p> : null}
      {success ? <p className="text-xs text-positive">{success}</p> : null}
      <p className="text-xs text-muted">
        Share the username and password with your client directly — this app
        never emails or displays the password again after you set it.
        Clients sign in at <code className="rounded bg-surface-2 px-1">/client/login</code>.
      </p>
    </div>
  );
}
