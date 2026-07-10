import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const currencySymbols: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

/** Format integer minor units as a display amount. */
export function formatMoney(minor: number, currency = "INR"): string {
  const major = minor / 100;
  const symbol = currencySymbols[currency] ?? `${currency} `;
  if (Math.abs(major) >= 10_000_000 && currency === "INR")
    return `${symbol}${(major / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(major) >= 100_000 && currency === "INR")
    return `${symbol}${(major / 100_000).toFixed(2)}L`;
  if (Math.abs(major) >= 1_000_000)
    return `${symbol}${(major / 1_000_000).toFixed(2)}M`;
  if (Math.abs(major) >= 10_000)
    return `${symbol}${(major / 1_000).toFixed(1)}k`;
  return `${symbol}${major.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function formatNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-IN");
}

export function formatPercent(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}
