import { NextResponse } from "next/server";

/**
 * Shared CSV building blocks for every export route (AUDIT_REPORT.md,
 * Medium: "CSV/PDF export — neither exists anywhere in the codebase").
 * One place for RFC 4180 escaping so no individual export route can get it
 * wrong or forget it on a one-off field. No "server-only" guard, unlike
 * most of features/* — same reasoning as lib/utils.ts's formatMoney/etc:
 * these are pure string helpers with no secrets or DB access, safe to ever
 * touch from a client bundle by mistake. Only csvResponse() needs
 * next/server, and only route.ts files (which can't be client-bundled by
 * construction) ever call it.
 */

/** Leading characters that Excel/Google Sheets treat as "this cell is a
 *  formula" — a field starting with one of these gets neutralized with a
 *  leading apostrophe (CWE-1236 / "CSV injection"). Every string field we
 *  export (contact names, campaign names, ...) is free text someone else
 *  typed or an ad platform returned, not something we generated, so this
 *  isn't hypothetical: a contact literally named
 *  `=HYPERLINK("http://evil","x")` is valid input today (contactSchema
 *  only checks length, see features/crm/actions.ts) and would otherwise
 *  execute as a formula the moment the exported CSV is opened. */
const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]/;

/** Escapes one CSV field per RFC 4180 (quote if it contains a comma,
 *  quote, or newline, doubling any embedded quotes) and neutralizes
 *  leading formula-trigger characters — see FORMULA_TRIGGER_RE. */
export function csvField(value: string | number): string {
  let s = String(value);
  if (FORMULA_TRIGGER_RE.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One CSV line from raw values. */
export function csvRow(values: Array<string | number>): string {
  return values.map(csvField).join(",");
}

/** Joins pre-built rows (from csvRow) with CRLF line endings — RFC 4180's
 *  wire format, which Excel and most spreadsheet tools expect over a bare
 *  LF. */
export function csvDocument(rows: string[]): string {
  return rows.join("\r\n") + "\r\n";
}

/** text/csv response with a download-triggering Content-Disposition —
 *  every CSV export route in the app returns exactly this. */
export function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/** Filesystem/header-safe filename fragment from arbitrary display text
 *  (e.g. a workspace name) — lowercase, alphanumeric-and-hyphen only. */
export function slugifyForFilename(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "") || "export"
  );
}
