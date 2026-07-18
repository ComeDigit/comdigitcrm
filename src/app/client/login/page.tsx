import { redirect } from "next/navigation";
import { getClientSession } from "@/lib/auth/client-session";
import { ClientLoginForm } from "@/features/client-portal/components/login-form";
import { ThemeToggle } from "@/components/shell/theme";

export const metadata = { title: "Client sign in" };

/**
 * Public login page for the client portal — sits outside the (portal)
 * route group specifically so it isn't gated by that group's own session
 * check (see app/client/(portal)/layout.tsx). Already-signed-in visitors
 * are sent straight to their dashboard instead of seeing the form again.
 */
export default async function ClientLoginPage() {
  const session = await getClientSession();
  if (session) redirect("/client");

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-accent text-[13px] font-bold text-accent-foreground">
            C
          </div>
          <h1 className="text-sm font-semibold tracking-tight">Client sign in</h1>
          <p className="mt-1 text-xs text-muted">
            Sign in with the username and password your agency gave you.
          </p>
        </div>
        <ClientLoginForm />
      </div>
    </main>
  );
}
