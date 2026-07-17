import type { RangePreset } from "@/features/metrics/queries";

/**
 * Server-rendered date-range picker — no client JS required. Preset pills
 * are plain links (`?preset=x`), which Next.js resolves relative to the
 * current path, so switching ranges is just a normal navigation with a
 * different query string. The custom-range form submits via a plain GET,
 * which every browser turns into `?since=...&until=...` on the same page
 * without any JavaScript at all. Same component drops into Overview,
 * Shopify, and every ad channel page (including the public share route)
 * so date selection behaves identically everywhere.
 */

const PRESETS: Array<{ key: Exclude<RangePreset, "custom">; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "last_7", label: "Last 7 days" },
  { key: "this_month", label: "This month" },
  { key: "last_30", label: "Last 30 days" },
  { key: "last_90", label: "Last 90 days" },
];

const pillCls = (active: boolean) =>
  `rounded-full border px-2.5 py-1 text-[12px] whitespace-nowrap transition-colors ${
    active
      ? "border-accent bg-accent/10 text-accent font-medium"
      : "border-border text-muted hover:bg-surface-2"
  }`;

export function DateRangePicker({
  preset,
  range,
}: {
  preset: RangePreset;
  range: { since: string; until: string };
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <a key={p.key} href={`?preset=${p.key}`} className={pillCls(preset === p.key)}>
          {p.label}
        </a>
      ))}
      <form method="GET" className="flex items-center gap-1.5">
        <input
          type="date"
          name="since"
          defaultValue={range.since}
          max={range.until}
          className="h-[26px] rounded-md border border-border bg-surface px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="text-[12px] text-muted">to</span>
        <input
          type="date"
          name="until"
          defaultValue={range.until}
          min={range.since}
          className="h-[26px] rounded-md border border-border bg-surface px-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button type="submit" className={pillCls(preset === "custom")}>
          Apply
        </button>
      </form>
    </div>
  );
}
