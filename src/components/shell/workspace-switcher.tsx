"use client";

import { useRouter } from "next/navigation";
import { demoWorkspaces } from "@/features/demo-data/generator";

/**
 * Client-brand switcher. Selection is a cookie so Server Components pick
 * it up on refresh. In live mode the list comes from the workspaces the
 * member can access (same cookie contract).
 */
export function WorkspaceSwitcher({
  workspaces = demoWorkspaces.map((w) => ({ id: w.id, name: w.name })),
  activeId,
}: {
  workspaces?: Array<{ id: string; name: string }>;
  activeId?: string;
}) {
  const router = useRouter();

  return (
    <select
      aria-label="Active client workspace"
      className="h-8 rounded-lg border border-border bg-surface px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      defaultValue={activeId ?? workspaces[0]?.id}
      onChange={(e) => {
        document.cookie = `ws=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
    >
      {workspaces.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Per-client "Open dashboard" action (used on /dashboard/clients). A plain
 * `<Link href="/dashboard">` here would only ever land on whichever
 * workspace the "ws" cookie already pointed to — it never actually switches
 * to THIS client, which silently breaks the moment there's more than one
 * client card on the page. Setting the cookie first (same mechanism as the
 * switcher above) before navigating is what makes it a real per-client link.
 */
export function OpenClientDashboardLink({
  workspaceId,
  className,
}: {
  workspaceId: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        document.cookie = `ws=${workspaceId}; path=/; max-age=31536000; samesite=lax`;
        router.push("/dashboard");
      }}
    >
      Open dashboard →
    </button>
  );
}
