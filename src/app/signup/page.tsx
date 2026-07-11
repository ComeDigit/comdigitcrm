"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/primitives";
import { createSupabaseBrowser } from "@/lib/supabase/client";

const signupSchema = z
  .object({
    email: z.string().email("Enter a valid email"),
    password: z
      .string()
      .min(10, "Minimum 10 characters")
      .regex(/[0-9]/, "Include at least one number"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type SignupInput = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const supabase = createSupabaseBrowser();
  const demo = supabase === null;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({ resolver: zodResolver(signupSchema) });

  async function onSubmit(values: SignupInput) {
    setServerError(null);
    if (!supabase) return;
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setServerError("Could not create the account. Try again.");
      return;
    }
    if (data.session) {
      router.push("/onboarding");
      router.refresh();
    } else {
      setEmailSent(true); // email confirmation flow
    }
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

        <h1 className="text-lg font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1 text-[13px] text-muted">
          Set up your agency in under a minute.
        </p>

        {demo ? (
          <div className="mt-6 space-y-3">
            <div className="rounded-lg border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
              Demo mode — sign-up needs a Supabase project. Explore the demo
              dashboard instead, then connect Supabase to go live.
            </div>
            <Link href="/dashboard" className="block">
              <Button className="w-full">Enter demo dashboard</Button>
            </Link>
          </div>
        ) : emailSent ? (
          <div className="mt-6 rounded-lg border border-border bg-surface px-4 py-3 text-[13px] leading-relaxed">
            Check your inbox — we sent a confirmation link. After confirming,
            you&apos;ll be taken to onboarding.
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-3" noValidate>
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
                autoComplete="new-password"
                className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...register("password")}
              />
              {errors.password ? (
                <p className="mt-1 text-xs text-negative">{errors.password.message}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="confirm" className="mb-1 block text-xs font-medium">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                {...register("confirm")}
              />
              {errors.confirm ? (
                <p className="mt-1 text-xs text-negative">{errors.confirm.message}</p>
              ) : null}
            </div>
            {serverError ? <p className="text-xs text-negative">{serverError}</p> : null}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create account"}
            </Button>
            <p className="text-center text-xs text-muted">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
