# GO LIVE — the complete checklist

Everything in the codebase is already wired. Going live is configuration,
not coding. Do these in order.

## 1. Supabase (~10 minutes) — unlocks auth + real data

1. Create a free project at [supabase.com](https://supabase.com) (region:
   Mumbai `ap-south-1` recommended for India).
2. In the Supabase **SQL Editor**, paste and run the entire contents of
   `supabase/setup_all.sql` (creates every table + all security policies).
3. **Auth → Hooks** → enable "Customize Access Token (JWT) Claims hook" →
   select `custom_access_token_hook`.
4. Collect your keys (**Project Settings → API** and **→ Database**):
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Secret key → `SUPABASE_SECRET_KEY`
   - Connection string (URI, pooled) → `DATABASE_URL`

## 2. Vercel env vars (~5 minutes)

Project → **Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from step 1 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | from step 1 |
| `SUPABASE_SECRET_KEY` | from step 1 (server-only) |
| `DATABASE_URL` | from step 1 |
| `APP_ENCRYPTION_KEY` | run `openssl rand -hex 32` |
| `CRON_SECRET` | run `openssl rand -hex 16` |

Redeploy (Deployments → ⋯ → Redeploy). The app flips from demo → live
automatically: real signup at `/signup`, onboarding creates your agency,
CRM saves for real.

## 3. Optional: sample data in the live database

```bash
DATABASE_URL="postgres://…" npm run db:seed
```

Populates the live DB with the same 3 demo brands + 30 days of metrics so
dashboards aren't empty while connectors are pending.

## 4. Meta connector (do the paperwork NOW — approval takes time)

1. [developers.facebook.com](https://developers.facebook.com) → Create App
   → type **Business** → link your Business Manager.
2. Add the **Marketing API** product.
3. App Settings → Basic: copy **App ID** and **App Secret** → add to
   Vercel as `META_APP_ID` and `META_APP_SECRET`.
4. Add OAuth redirect: App → Facebook Login → Settings → Valid OAuth
   Redirect URIs → `https://YOUR-DOMAIN.vercel.app/api/integrations/meta/callback`.
5. Redeploy → Settings page now shows **Connect** on Meta Ads → click it,
   approve, and the first 90-day backfill queues automatically.
6. For client accounts (not your own Business Manager): submit **App
   Review** for `ads_read` + **Business Verification**. Start this early —
   it takes days to weeks. Your own accounts work without it.

## 5. Google Ads (start the wait early too)

Apply for a **Developer Token** in a Google Ads Manager (MCC) account →
API Center. Basic access approval is the slow part. Store as
`GOOGLE_ADS_DEVELOPER_TOKEN` when granted (connector lands Phase 8).

## 6. Sync scheduling

`vercel.json` ships two daily crons (Hobby-plan compatible): the tick
(enqueues sync jobs) and the worker (runs them). Vercel automatically
sends `CRON_SECRET` as the bearer token once the env var exists. For
10-minute syncs later: Vercel Pro, or a free Cloudflare Worker cron
hitting `/api/cron/tick` + `/api/jobs/run`, or Supabase `pg_cron`.

## What activates when

| You add | You get |
|---|---|
| Supabase keys | Real login, onboarding, editable CRM, audit log |
| `npm run db:seed` | Populated dashboards pre-connectors |
| `META_APP_ID/SECRET` | Connect button → OAuth → encrypted token → auto backfill → real Meta numbers on the dashboard |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | (Phase 11) AI Q&A over your data |
| Razorpay/Stripe keys | (Phase 13) client billing |
