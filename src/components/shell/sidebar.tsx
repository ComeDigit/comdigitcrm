"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  ShoppingBag,
  Megaphone,
  Search,
  LineChart,
  CheckSquare,
  Settings,
  Sparkles,
  History,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isDemoMode } from "@/lib/env";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/dashboard/clients", label: "Clients", icon: Users },
      { href: "/dashboard/tasks", label: "Tasks", icon: CheckSquare },
    ],
  },
  {
    section: "Channels",
    items: [
      { href: "/dashboard/shopify", label: "Shopify", icon: ShoppingBag },
      { href: "/dashboard/ads/meta", label: "Meta Ads", icon: Megaphone },
      { href: "/dashboard/ads/google", label: "Google Ads", icon: Search },
      { href: "/dashboard/ads/tiktok", label: "TikTok Ads", icon: LineChart },
    ],
  },
  {
    section: "Workspace",
    items: [
      { href: "/dashboard/ai", label: "AI Copilot", icon: Sparkles },
      { href: "/dashboard/activity", label: "Activity log", icon: History },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

const Wordmark = () => (
  <div className="flex items-center gap-2">
    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-accent-foreground">
      C
    </div>
    <span className="text-sm font-semibold tracking-tight">ComeDigit</span>
  </div>
);

/** The nav list itself, shared by the desktop rail and the mobile drawer so
 *  the two can never drift apart. onNavigate fires on every link click —
 *  the mobile drawer uses it to close itself after navigating. */
function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
      {NAV.map((group) => (
        <div key={group.section}>
          <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted">
            {group.section}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active =
                item.href === "/dashboard"
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors",
                      active
                        ? "bg-surface-2 font-medium text-foreground"
                        : "text-muted hover:bg-surface-2 hover:text-foreground",
                    )}
                  >
                    <item.icon size={15} strokeWidth={1.8} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

const statusLine = isDemoMode ? "Demo mode · no keys needed" : "Live · connected to Supabase";

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Belt-and-suspenders: also close on route change (covers back/forward
  // nav and any link that doesn't go through NavLinks' own onClick). Adjusts
  // state during render (the documented pattern for "reset state when a
  // value changes") rather than a useEffect, which would setState after an
  // extra commit for no benefit here.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileOpen(false);
  }

  return (
    <>
      {/* Desktop rail — unchanged from before, just the ≥md breakpoint.
       *  print:hidden — pure nav chrome, no reason to appear on a printed
       *  report (see globals.css for the rest of the print rules). */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r border-border bg-surface md:flex print:hidden">
        <div className="flex h-14 items-center px-5">
          <Wordmark />
        </div>
        <NavLinks pathname={pathname} />
        <div className="border-t border-border px-5 py-3">
          <p className="text-[11px] text-muted">{statusLine}</p>
        </div>
      </aside>

      {/* Mobile top bar — the admin dashboard previously had NO navigation
       *  at all below the md breakpoint (the aside above just vanishes).
       *  This is a normal (non-fixed) bar so it scrolls away naturally and
       *  lets each page's own sticky Topbar take over the top of the
       *  viewport, exactly like it does on desktop. */}
      <div className="flex h-12 items-center justify-between border-b border-border bg-surface px-4 md:hidden print:hidden">
        <Wordmark />
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground"
        >
          <Menu size={18} />
        </button>
      </div>

      {/* Mobile drawer + backdrop */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden print:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col border-r border-border bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between px-5">
              <Wordmark />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            <div className="border-t border-border px-5 py-3">
              <p className="text-[11px] text-muted">{statusLine}</p>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
