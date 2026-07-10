import { Topbar } from "@/components/shell/topbar";
import { Card, CardHeader, Badge } from "@/components/ui/primitives";
import { isDemoMode } from "@/lib/env";

export const metadata = { title: "Settings" };

const PROVIDERS = [
  { key: "shopify", label: "Shopify", phase: "Phase 6" },
  { key: "meta", label: "Meta Ads", phase: "Phase 7" },
  { key: "google_ads", label: "Google Ads", phase: "Phase 8" },
  { key: "tiktok", label: "TikTok Ads", phase: "Phase 9" },
  { key: "ga4", label: "Google Analytics 4", phase: "Phase 10" },
  { key: "search_console", label: "Search Console", phase: "Phase 10" },
];

export default function SettingsPage() {
  return (
    <>
      <Topbar title="Settings" />
      <main className="space-y-6 px-6 py-6">
        <Card>
          <CardHeader
            title="Environment"
            subtitle="How this deployment is configured"
          />
          <div className="space-y-2 px-5 pb-5 pt-2 text-[13px]">
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <span>Mode</span>
              <Badge tone={isDemoMode ? "outline" : "positive"}>
                {isDemoMode ? "Demo (deterministic data, zero keys)" : "Live (Supabase connected)"}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-muted">
              To go live: create a Supabase project, copy .env.example to
              .env.local, fill in the Supabase URL, publishable key and database
              URL, run <code className="rounded bg-surface-2 px-1">npm run db:push</code>{" "}
              and apply <code className="rounded bg-surface-2 px-1">supabase/migrations/0002_rls.sql</code>.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Integrations"
            subtitle="OAuth connection flows land with each integration phase; every module already runs on the shared provider contract"
          />
          <div className="space-y-2 px-5 pb-5 pt-2">
            {PROVIDERS.map((p) => (
              <div
                key={p.key}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-[13px]"
              >
                <span className="font-medium">{p.label}</span>
                <Badge tone="outline">Mock active · live in {p.phase}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </main>
    </>
  );
}
