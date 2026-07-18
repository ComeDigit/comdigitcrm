"use client";

import { useState, useTransition } from "react";
import { LogIn } from "lucide-react";
import { clientLogin } from "@/features/client-portal/actions";
import { Button } from "@/components/ui/primitives";

const inputCls =
  "h-10 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The client portal's sign-in form. On success, clientLogin() itself calls
 * redirect("/client") server-side — there's no client-side navigation here,
 * which also means a thrown NEXT_REDIRECT from inside startTransition is
 * expected and simply lets Next.js take over, not an error to catch.
 */
export function ClientLoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await clientLogin(username, password);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <label className="mb-1 block text-xs text-muted">Username</label>
        <input
          className={inputCls}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted">Password</label>
        <input
          className={inputCls}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      {error ? <p className="text-xs text-negative">{error}</p> : null}
      <Button type="submit" disabled={pending || !username || !password} className="w-full justify-center">
        <LogIn size={13} /> {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
