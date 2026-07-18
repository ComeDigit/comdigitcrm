import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getClientSession } from "@/lib/auth/client-session";
import { getWorkspaceName } from "@/lib/workspace";
import { ClientNav } from "@/components/shell/client-nav";

/**
 * Wraps every authenticated /client/* page (Overview, Shopify, Meta/Google/
 * TikTok Ads, AI Copilot) — NOT /client/login, which lives outside this
 * route group specifically so it isn't gated by the same session check.
 * Resolves the workspace purely from the server-side session lookup, never
 * from a cookie/query param a client could edit — see client-session.ts.
 */
export default async function ClientPortalLayout({ children }: { children: ReactNode }) {
  const session = await getClientSession();
  if (!session) redirect("/client/login");

  const workspaceName = await getWorkspaceName(session.workspaceId);

  return (
    <div className="min-h-screen">
      <ClientNav workspaceName={workspaceName} username={session.username} />
      {children}
    </div>
  );
}
