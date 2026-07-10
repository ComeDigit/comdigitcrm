"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/primitives";
import { createSupabaseBrowser } from "@/lib/supabase/client";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Minimum 8 characters"),
});

type LoginInput = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const supabase = createSupabaseBrowser();
  const demo = supabase === null;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    setServerError(null);
    if (!supabase) return; // demo mode — button below goes straight in
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      // Generic message: never reveal whether the email exists.
      setServerError("Invalid email or password.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-foreground">
            C
          </div>
          <span className="text-sm font-semibold tracking-tight">
            ComeDigit CRM
          </span>
        </div>

        <h1 className="text-lg font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-[13px] text-muted">
          Sign in to your agency workspace.
        </p>

        {demo ? (
          <div className="mt-6 space-y-3">
            <div className="rounded-lg border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
              Demo mode — no Supabase project connected, so authentication is
              disabled and the dashboard runs on deterministic sample data.
            </div>
            <Link href="/dashboard" className="block">
              <Button className="w-full">Enter demo dashboard</Button>
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="mt-6 space-y-3"
            noValidate
          >
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...register("email")}
              />
              {errors.email ? (
                <p className="mt-1 text-xs text-negative">{errors.email.message}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-medium">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...register("password")}
              />
              {errors.password ? (
                <p className="mt-1 text-xs text-negative">
                  {errors.password.message}
                </p>
              ) : null}
            </div>
            {serverError ? (
              <p className="text-xs text-negative">{serverError}</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
