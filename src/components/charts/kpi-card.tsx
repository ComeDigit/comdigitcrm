import { Info } from "lucide-react";
import { Card, Delta } from "@/components/ui/primitives";

export function KpiCard({
  label,
  value,
  delta,
  hint,
  info,
}: {
  label: string;
  value: string;
  /** Fractional change vs previous period, e.g. 0.12 = +12%. */
  delta?: number;
  hint?: string;
  /** Plain-language explanation shown on hover — makes acronyms (ROAS, CPA, MER…) approachable. */
  info?: string;
}) {
  return (
    <Card className="px-5 py-4">
      <div className="flex items-center gap-1">
        <p className="text-xs text-muted">{label}</p>
        {info ? (
          <span title={info} className="cursor-help text-muted/60 hover:text-muted">
            <Info size={11} strokeWidth={2} />
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <p className="text-xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        {delta !== undefined ? <Delta value={delta} /> : null}
      </div>
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </Card>
  );
}
