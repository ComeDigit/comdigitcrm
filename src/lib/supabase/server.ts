import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env, isDemoMode } from "@/lib/env";

/**
 * Per-request Supabase client for Server Components, Server Actions and
 * Route Handlers. Uses the publishable key + user session cookie, so all
 * queries through it are RLS-enforced.
 */
export async function createSupabaseServer() {
  if (isDemoMode) return null;
  const cookieStore = await cookies();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — middleware handles refresh.
          }
        },
      },
    },
  );
}
