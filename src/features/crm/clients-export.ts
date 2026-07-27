import "server-only";
import { csvRow, csvDocument } from "@/lib/csv";
import type { WorkspaceRow, ContactRow } from "@/features/crm/queries";
import type { ShopFacts } from "@/lib/metrics/definitions";

export interface ClientExportRow {
  workspace: WorkspaceRow;
  totals: ShopFacts;
  contacts: ContactRow[];
}

const toMajor = (minor: number): string => (minor / 100).toFixed(2);

const HEADERS = ["Client", "Status", "Vertical", "Website", "Net revenue (30d)", "Orders (30d)", "Contacts"];

/**
 * Mirrors the Clients roster cards: same fields, same 30-day window, one
 * row per client with every contact joined into a single cell (name
 * <email>; name <email>...) rather than one row per contact — keeps "one
 * row per client" simple, matching the roster's one-card-per-client shape.
 */
export function clientsToCsv(rows: ClientExportRow[]): string {
  const lines = [csvRow(HEADERS)];
  for (const r of rows) {
    const contactsStr = r.contacts
      .map((c) => (c.email ? `${c.fullName} <${c.email}>` : c.fullName))
      .join("; ");
    lines.push(
      csvRow([
        r.workspace.name,
        r.workspace.status,
        r.workspace.vertical ?? "",
        r.workspace.website ?? "",
        toMajor(r.totals.netSalesMinor),
        r.totals.orders,
        contactsStr,
      ]),
    );
  }
  return csvDocument(lines);
}
