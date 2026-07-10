# ComeDigit CRM

AI-powered marketing CRM for agencies and D2C brands — Shopify, Meta Ads,
Google Ads, TikTok, GA4 and client management in one dashboard.

**Stack:** Next.js (App Router, Server Components) · TypeScript strict ·
Tailwind CSS · Drizzle ORM · Supabase (Postgres, Auth, RLS, Storage) ·
TanStack Query/Table · Recharts · Zod · deployed on Vercel.

## Run it now (zero keys)

```bash
npm install
npm run dev
```

Open http://localhost:3000 — the app boots in **demo mode**: deterministic
sample data (seeded PRNG — same numbers every reload), no Supabase project
required. Every dashboard, chart and insight works.

## Go live

1. Create a Supabase project (free tier is fine) at supabase.com.
2. `cp .env.example .env.local` and fill in:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `CRON_SECRET`.
3. Push the schema: `npm run db:push`
4. Apply RLS + auth hook: run `supabase/migrations/0002_rls.sql` in the
   Supabase SQL editor, then enable the `custom_access_token_hook` under
   **Auth → Hooks**.
5. Deploy to Vercel (`vercel.json` already schedules the sync cron).

## Architecture (Phase 1 doc has the full rationale)

- **One Next.js app** — Server Components read, Server Actions/Route
  Handlers write; no separate backend. Long work runs via a Postgres job
  queue (`job_queue`, FOR UPDATE SKIP LOCKED) drained by workers.
- **Tenancy** — Organization (agency) → Workspace (client brand). RLS on
  every table via JWT claims + `has_workspace_access()`; app code also
  scopes queries explicitly (defense in depth). Integration tokens live in
  a no-RLS-grant table, encrypted, service-role only.
- **Metrics** — typed daily fact tables; money as integer minor units;
  ROAS/CTR/CPA/AOV/MER computed ONLY in `src/lib/metrics/definitions.ts`
  (never stored, never duplicated).
- **Integrations** — every provider implements the `AdsProvider` contract
  (`src/features/integrations/types.ts`). A deterministic mock satisfies
  the same contract, so the entire product is developable and testable
  with zero API keys; real clients slot in per phase without upstream
  changes.
- **Demo mode** — missing Supabase env = demo mode (`src/lib/env.ts`).
  One facade (`src/features/metrics/queries.ts`) switches between the
  seeded generator and real fact tables; pages never know which ran.

```
src/
├─ app/                 # routes only — thin, delegate to features
│  ├─ dashboard/        # overview, clients, tasks, shopify, ads/*, ai, settings
│  └─ api/              # v1/health, cron/tick, webhooks/shopify
├─ features/            # feature-based modules (ads, metrics, integrations, demo-data)
├─ components/          # ui primitives, shell, charts
├─ db/schema/           # Drizzle schema: tenancy, ops, crm, metrics
├─ lib/                 # env, db, supabase, authorize, jobs, metrics definitions
└─ proxy.ts             # session refresh + route protection (Next 16)
supabase/migrations/    # RLS policies + auth claims hook
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (demo mode without env) |
| `npm run build` | Production build |
| `npm run lint` | ESLint (zero warnings policy) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run db:generate` | Generate SQL migration from Drizzle schema |
| `npm run db:push` | Push schema to the database in `DATABASE_URL` |

## Phase status

| Phase | Status |
|---|---|
| 1 Architecture | ✅ (`ComeDigit_Phase1_Architecture.md`) |
| 2 Database | ✅ schema + RLS + queue + cursors |
| 3 Authentication | ✅ Supabase Auth wiring + demo mode (OAuth/invites: next) |
| 4 Organizations & workspaces | ✅ model + switcher (management UI: next) |
| 5 Client CRM | ◐ roster + contacts + tasks (deals/invoices UI: next) |
| 6–9 Integrations | ◐ provider contract + mock + queue + webhook receiver (live OAuth per phase) |
| 10 Analytics | ◐ metric definitions + facts (GA4/GSC sync: next) |
| 11 AI Engine | ◐ statistical insight engine v0 (LLM tool-calling: next) |
| 12–15 Reporting/Automations/Billing/Deploy | queue + cron scaffolding in place |

Security notes: HMAC-verified webhooks (timing-safe), CRON_SECRET-guarded
cron, generic auth errors, no secrets client-side, RLS everywhere,
`integration_secrets` unreachable from user sessions by construction.
