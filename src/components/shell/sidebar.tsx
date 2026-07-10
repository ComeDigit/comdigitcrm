"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-14 items-center gap-2 px-5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-accent-foreground">
          C
        </div>
        <span className="text-sm font-semibold tracking-tight">
          ComeDigit
        </span>
      </div>
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
      <div className="border-t border-border px-5 py-3">
        <p className="text-[11px] text-muted">Demo mode · no keys needed</p>
      </div>
    </aside>
  );
}
