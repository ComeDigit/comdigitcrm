import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * OAuth / magic-link / email-confirmation callback: exchanges the auth
 * code for a session cookie, then forwards to onboarding (new users) or
 * the dashboard. `next` is validated to a same-origin path — never an
 * open redirect.
 */
export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/onboarding";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/onboarding";

  if (!url || !key || !code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=auth`);
  return response;
}
