"use client";

import { useActionState } from "react";
import { completeOnboarding, type ActionResult } from "@/features/auth/actions";
import { Button } from "@/components/ui/primitives";

const initialState: ActionResult = {};

/** First-login setup: name your agency and your first client workspace. */
export default function OnboardingPage() {
  const [state, formAction, pending] = useActionState(
    completeOnboarding,
    initialState,
  );

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-foreground">
            C
          </div>
          <span className="text-sm font-semibold tracking-tight">ComeDigit CRM</span>
        </div>

        <h1 className="text-lg font-semibold tracking-tight">Set up your agency</h1>
        <p className="mt-1 text-[13px] text-muted">
          You can add more client workspaces and invite your team later.
        </p>

        <form action={formAction} className="mt-6 space-y-3">
          <div>
            <label htmlFor="orgName" className="mb-1 block text-xs font-medium">
              Agency / company name
            </label>
            <input
              id="orgName"
              name="orgName"
              required
              minLength={2}
              maxLength={80}
              placeholder="ComeDigit Agency"
              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="workspaceName" className="mb-1 block text-xs font-medium">
              First client / brand
            </label>
            <input
              id="workspaceName"
              name="workspaceName"
              required
              minLength={2}
              maxLength={80}
              placeholder="My First Client"
              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {state.error ? <p className="text-xs text-negative">{state.error}</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating…" : "Create workspace"}
          </Button>
        </form>
      </div>
    </main>
  );
}
