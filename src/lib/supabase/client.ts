"use client";

import { createBrowserClient } from "@supabase/ssr";
import { env, isDemoMode } from "@/lib/env";

/** Browser Supabase client (publishable key only — RLS enforced). */
export function createSupabaseBrowser() {
  if (isDemoMode) return null;
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
