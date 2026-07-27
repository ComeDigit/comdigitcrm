"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import {
  LayoutDashboard,
  ShoppingBag,
  Megaphone,
  Search,
  LineChart,
  Sparkles,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/shell/theme";
import { clientLogoutAction } from "@/features/client-portal/actions";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: "/client", label: "Overview", icon: LayoutDashboard },
  { href: "/client/shopify", label: "Shopify", icon: ShoppingBag },
  { href: "/client/ads/meta", label: "Meta Ads", icon: Megaphone },
  { href: "/client/ads/google", label: "Google Ads", icon: Search },
  { href: "/client/ads/tiktok", label: "TikTok Ads", icon: LineChart },
  { href: "/client/ai", label: "AI Copilot", icon: Sparkles },
];

/**
 * Minimal nav for the client portal — deliberately NOT the internal
 * Sidebar/Topbar: no workspace switcher (a client's session is locked to
 * exactly one workspace, resolved server-side — see requireClientSession),
 * no Settings/Clients/Tasks links, nothing that implies access beyond this
 * one client's own data.
 */
export function ClientNav({ workspaceName, username }: { workspaceName: string; username: string }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur print:hidden">
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-accent-foreground">
            C
          </div>
          <span className="truncate text-sm font-semibold tracking-tight">{workspaceName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted sm:inline">{username}</span>
          <ThemeToggle />
          <button
            disabled={pending}
            onClick={() => startTransition(async () => { await clientLogoutAction(); })}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <LogOut size={13} /> Log out
          </button>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-4 pb-2">
        {NAV.map((item) => {
          const active = item.href === "/client" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                active
                  ? "bg-surface-2 font-medium text-foreground"
                  : "text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <item.icon size={14} strokeWidth={1.8} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
