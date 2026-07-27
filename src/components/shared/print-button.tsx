"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/primitives";

/**
 * AUDIT_REPORT.md — Medium: "CSV/PDF export — neither exists anywhere."
 * PDF export is the browser's own Print dialog (Save as PDF), not a
 * server-rendered file: no Puppeteer/headless-browser dependency, no
 * Vercel serverless timeout/memory risk, and it reuses the exact page the
 * user is already looking at instead of a second rendering path that could
 * drift out of sync. Pairs with the `@media print` rules in globals.css
 * (forces light colors so a report printed from dark mode doesn't come out
 * black-on-black) and the `print:hidden` utility applied to nav chrome,
 * forms, and per-row action buttons throughout the report pages.
 */
export function PrintButton() {
  return (
    <Button
      type="button"
      variant="outline"
      className="print:hidden"
      onClick={() => window.print()}
    >
      <Printer size={13} /> Print / Save PDF
    </Button>
  );
}
