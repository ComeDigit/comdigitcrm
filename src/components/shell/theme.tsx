"use client";

import { Moon, Sun } from "lucide-react";

/**
 * Dark/light theme with zero React state: the `dark` class on <html> is
 * the single source of truth (set pre-paint by the inline script in the
 * root layout, persisted in a cookie — not localStorage, per project
 * rules). Icons swap via CSS, so there is nothing to hydrate and no
 * flash of the wrong theme.
 */
export function ThemeToggle() {
  return (
    <button
      onClick={() => {
        const dark = document.documentElement.classList.toggle("dark");
        document.cookie = `theme=${dark ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
      }}
      aria-label="Toggle theme"
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      <Sun size={15} className="hidden dark:block" />
      <Moon size={15} className="dark:hidden" />
    </button>
  );
}

/** Runs before paint — no theme flash. Kept tiny and dependency-free. */
export const themeInitScript = `(function(){try{if(document.cookie.indexOf("theme=dark")!==-1)document.documentElement.classList.add("dark")}catch(e){}})()`;
