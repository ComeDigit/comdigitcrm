import { Card, Delta } from "@/components/ui/primitives";

export function KpiCard({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  /** Fractional change vs previous period, e.g. 0.12 = +12%. */
  delta?: number;
  hint?: string;
}) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs text-muted">{label}</p>
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
