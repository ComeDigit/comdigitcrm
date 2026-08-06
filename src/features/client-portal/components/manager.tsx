"use client";

import { useEffect, useState, useTransition } from "react";
import { KeyRound, Power, Trash2, LockOpen, Shuffle, Copy, Check, Eye, EyeOff } from "lucide-react";
import {
  getClientLogin,
  saveClientLogin,
  setClientLoginStatus,
  unlockClientLogin,
  deleteClientLogin,
  type ClientLoginSummary,
  type ClientLoginLookup,
} from "@/features/client-portal/actions";
import { Badge, Button } from "@/components/ui/primitives";

const inputCls =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Deliberately excludes the characters that get misread when a password is
 * read aloud or retyped off a screenshot: 0/O, 1/l/I, and the symbols that
 * need escaping when pasted into a shell or a chat app. 20 chars from this
 * 60-char alphabet is ~118 bits, which is plenty for a portal login.
 */
const PASSWORD_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generated in the browser via the Web Crypto API so the plaintext never
 * travels anywhere except into the form field the admin is already typing
 * into. Math.random would be wrong here — it's not a CSPRNG.
 */
function generatePassword(length = 20): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  // Modulo bias is negligible at 2^32 % 56, and the alternative (rejection
  // sampling) buys nothing at this alphabet size.
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");
}

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
  /**
   * `null` means "haven't heard back yet" and is deliberately distinct from
   * `{ state: "none" }`. Rendering the initial state as "No client login
   * yet" — the old behaviour — told the admin a login didn't exist every
   * time the lookup was slow or failed, while the client could sign in
   * with it perfectly well.
   */
  const [lookupFor, setLookupFor] = useState<{ ws: string; result: ClientLoginLookup } | null>(null);
  /**
   * Tagged with the workspace it describes, so switching clients shows
   * "checking…" immediately instead of briefly showing the previous
   * client's login — and so a slow response for the workspace you just
   * navigated away from can never overwrite the one you're looking at.
   */
  const lookup: ClientLoginLookup | null =
    lookupFor && lookupFor.ws === workspaceId ? lookupFor.result : null;
  const login: ClientLoginSummary | null = lookup?.state === "found" ? lookup.login : null;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  /**
   * The credentials to hand the client, held only until the admin navigates
   * away. The server hashes the password and can never show it again, so
   * clearing the field on save (the old behaviour) meant a generated
   * password was destroyed before anyone could copy it.
   */
  const [handoff, setHandoff] = useState<{ username: string; password: string } | null>(null);

  function refresh(ws: string) {
    // No synchronous "clear" here on purpose: staleness is derived from
    // `lookupFor.ws !== workspaceId`, so switching workspaces already reads
    // as "checking…" without a setState inside the effect that calls this.
    startTransition(async () => {
      const result = await getClientLogin(ws);
      setLookupFor({ ws, result });
      // Only overwrite what the admin sees when the answer is authoritative.
      // On an error we leave the username box alone rather than blanking it.
      if (result.state === "found") setUsername(result.login.username);
      else if (result.state === "none") setUsername("");
      setPassword("");
      setShowPassword(false);
    });
  }

  useEffect(() => {
    if (workspaceId) refresh(workspaceId);
  }, [workspaceId]);

  function save() {
    setError(null);
    setSuccess(null);
    setCopied(false);
    const submitted = { username: username.trim().toLowerCase(), password };
    startTransition(async () => {
      const result = await saveClientLogin(workspaceId, username, password);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(login ? "Login updated." : "Login created.");
      setHandoff(submitted);
      refresh(workspaceId);
    });
  }

  const workspaceName = workspaces.find((w) => w.id === workspaceId)?.name ?? "your account";
  const portalUrl = typeof window === "undefined" ? "/client/login" : `${window.location.origin}/client/login`;
  const handoffMessage = handoff
    ? `Your ${workspaceName} reporting dashboard is ready.\n\n` +
      `Sign in: ${portalUrl}\n` +
      `Username: ${handoff.username}\n` +
      `Password: ${handoff.password}\n\n` +
      `You'll see live ad spend, performance and store numbers for your account. ` +
      `Please change nothing about this link — it's specific to you.`
    : "";

  function copyHandoff() {
    if (!handoffMessage) return;
    void navigator.clipboard.writeText(handoffMessage).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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

  function unlock() {
    if (!login) return;
    startTransition(async () => {
      const result = await unlockClientLogin(login.id, workspaceId);
      if (!result.error) refresh(workspaceId);
    });
  }

  const isLocked = Boolean(login?.lockedUntil && new Date(login.lockedUntil) > new Date());

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
            {isLocked ? (
              <p className="text-xs text-negative">
                Locked until {new Date(login.lockedUntil as string).toLocaleTimeString("en-IN")}{" "}
                after too many failed sign-ins.
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={login.status === "active" ? "positive" : "outline"}>
              {login.status === "active" ? "Active" : "Disabled"}
            </Badge>
            {isLocked ? (
              <Button variant="outline" disabled={pending} onClick={unlock}>
                <LockOpen size={13} /> Unlock
              </Button>
            ) : null}
            <Button variant="outline" disabled={pending} onClick={toggleStatus}>
              <Power size={13} /> {login.status === "active" ? "Disable" : "Enable"}
            </Button>
            <Button variant="outline" disabled={pending} onClick={remove}>
              <Trash2 size={13} /> Delete
            </Button>
          </div>
        </div>
      ) : lookup === null ? (
        <p className="text-xs text-muted">Checking for an existing login…</p>
      ) : lookup.state === "error" ? (
        <p className="text-xs text-negative">
          {lookup.reason} Don&apos;t create a new login until this loads — this
          workspace may already have one.
        </p>
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
        <div className="min-w-[14rem]">
          <label className="mb-1 block text-xs text-muted">Password</label>
          <div className="flex items-center gap-1">
            <input
              className={inputCls}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <Button
              variant="outline"
              type="button"
              title={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
            </Button>
            <Button
              variant="outline"
              type="button"
              title="Generate a strong password"
              onClick={() => {
                setPassword(generatePassword());
                setShowPassword(true);
              }}
            >
              <Shuffle size={13} /> Generate
            </Button>
          </div>
        </div>
        <Button disabled={pending || !workspaceId} onClick={save}>
          {/* "Save login" while the lookup is unresolved: the server upserts
              by workspace either way, so promising "Create" when a login may
              already exist would be a lie the button can't keep. */}
          <KeyRound size={13} />{" "}
          {login ? "Update login" : lookup?.state === "none" ? "Create login" : "Save login"}
        </Button>
      </div>

      {error ? <p className="text-xs text-negative">{error}</p> : null}
      {success ? <p className="text-xs text-positive">{success}</p> : null}

      {handoff ? (
        <div className="space-y-2 rounded-lg border border-positive/40 bg-positive/5 px-3 py-3">
          <p className="text-xs font-medium">
            Copy this now — the password is hashed on save and can never be shown again.
          </p>
          <pre className="whitespace-pre-wrap break-all rounded bg-surface-2 px-2 py-2 text-[12px]">
            {handoffMessage}
          </pre>
          <div className="flex items-center gap-2">
            <Button variant="outline" type="button" onClick={copyHandoff}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy message"}
            </Button>
            <Button variant="ghost" type="button" onClick={() => setHandoff(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted">
        Share the username and password with your client directly — this app
        never emails or displays the password again after you set it.
        Clients sign in at <code className="rounded bg-surface-2 px-1">/client/login</code>.
      </p>
    </div>
  );
}
