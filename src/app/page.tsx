import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { isDemoMode } from "@/lib/env";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-foreground">
          C
        </div>
        <span className="text-sm font-semibold tracking-tight">ComeDigit CRM</span>
      </div>

      <h1 className="mt-10 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        Every client. Every channel.
        <br />
        <span className="text-muted">One dashboard.</span>
      </h1>
      <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
        Shopify revenue, Meta, Google and TikTok ad performance, blended MER
        and profit — unified per client, with AI insights computed from your
        actual numbers. Built for agencies and D2C brands.
      </p>

      <div className="mt-8 flex items-center gap-3">
        <Link href="/dashboard">
          <Button>
            Open dashboard <ArrowRight size={14} />
          </Button>
        </Link>
      </div>

      <p className="mt-16 text-xs text-muted">
        {isDemoMode
          ? "Running in demo mode with deterministic sample data — connect Supabase to go live."
          : "Live — connected to Supabase. No login wall; anyone with this URL can open the dashboard."}
      </p>
    </main>
  );
}
