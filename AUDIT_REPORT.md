# ComeDigit CRM — Independent QA, Product & Security Audit

**Scope:** full source tree at the current `main` branch (commit `88edc52`). Every item below was checked against actual code — file paths and line numbers are cited as evidence. Nothing here is asserted from the product description alone; where something couldn't be verified, it's marked as such rather than assumed.

---

## Overall Completion: ~57%

This is a weighted estimate across every individual line item in your spec (including sub-bullets like Age/Gender/Placement/Country under "Audience Breakdown," counted separately) — Complete = 1 point, Partial = 0.5, Missing = 0, summed across roughly 165 checkable items and divided by the total. It is a methodology, not a precise measurement — treat it as directionally honest, not exact to the point.

The honest shape of that number: the **foundation is unusually solid** for this stage — real tenant isolation, real OAuth against all four ad/commerce platforms, real live data pulls, encrypted passwords, IDOR-safe queries. The score is dragged down by **breadth**, not depth: agency/client lifecycle management (edit, delete, suspend, search a client) and the deeper per-platform reporting surface (keywords, audience breakdowns, product-level Shopify data, ad-set/ad-level Meta data) are the two biggest gaps, plus a handful of commercial-SaaS basics (billing, rate limiting, search/pagination/export) that haven't been started.

---

## Completed Features

**Core architecture**
✔ Real live data pulls from Meta, Google Ads, TikTok, and Shopify — on-demand per page view, not a stale nightly sync (`src/features/integrations/*-live.ts`)
✔ OAuth "Connect" flow for all four providers, each with signed-state CSRF protection (`src/app/api/integrations/{meta,shopify,google_ads,tiktok}/{start,callback}/route.ts`)
✔ Tenant isolation for the client portal — workspace id is resolved server-side from a hashed session token, never from client input, verified across all 8 `/client/**` route files with zero exceptions
✔ Encrypted, salted client passwords (scrypt, timing-safe comparison — `client-session.ts:29-42`)
✔ Every mutating server action pairs `authorize()` with a tenant-scoped `WHERE` clause — spot-checked 8 actions, zero exceptions found
✔ Revoke/disable a client's login — enforced both at next-login and mid-session (`client-portal/actions.ts:191`, `client-session.ts:95`)
✔ Assign a specific ad account/store to a specific client is required (not optional/auto-guessed) on every connect flow
✔ Per-client, per-provider API connection health indicator (live/idle/no_access) in Settings
✔ Dark mode — full token-based theme, cookie-persisted, pre-paint script avoids flash (`theme.tsx`, `globals.css:23-38`)
✔ Charts/graphs — Recharts-based, rendered on every report page in both the admin and client trees
✔ Date range picker + comparison-vs-previous-period on every report-style page (Overview, Shopify, all three Ads channels), consistently present in both the admin and client route trees
✔ CSRF, XSS, and SQL-injection protection all check out clean (see Security Issues for detail)
✔ Google Ads GAQL date-range values pass through an `assertIsoDate()` guard before interpolation, at both call sites

**Admin**
✔ Create client, generate client login, view all clients, last-login display, per-connection health status

---

## Partially Completed

⚠ **Reset password** — works, but is the same "save login" form used for initial setup, not a distinct reset flow (no temp password, no forced-change flag, no notification). `client-portal/actions.ts:71-130`.

⚠ **Activity/audit logs** — real table, actively written for CRM actions (contact/task/workspace create, task status), but nothing ever reads it back — there is no admin page that displays the log. Client logins/logouts and every provider connect/disconnect are never logged at all.

⚠ **Role-based access control** — the permission system itself (`authorize.ts`) is fully built (10 roles, 12 actions, an explicit grant map) and every check is wired correctly, but `getPrincipal()` always returns the same fixed `agency_owner` principal with no real login on the admin side — so today it can never actually deny anything. The machinery is complete; the differentiation it's meant to provide is dormant.

⚠ **Global connected-accounts view** — Settings does list every ad account/store across the whole agency in one place, but each row shows only the ad account/store's own name, never which client it belongs to — you can't tell at a glance who owns what once you have more than a couple of clients.

⚠ **Token refresh / automatic reconnect** — Google Ads and TikTok both auto-refresh access tokens with zero human action; Meta has no refresh path (long-lived token only, with an expiry warning) and Shopify's token doesn't expire. Once any token is actually revoked (not just expired), all four require a manual reconnect in Settings — there's no case where a fully-revoked connection heals itself.

⚠ **Webhooks** — the Shopify webhook route genuinely verifies Shopify's HMAC signature and stores the event (not a stub), but nothing anywhere reads those stored rows back out — it writes to a queue no consumer drains. No webhook endpoints exist for Meta, Google Ads, or TikTok.

⚠ **Responsive design / mobile-friendly** — the admin dashboard's navigation is hidden entirely below 768px with no hamburger/drawer replacement, making the agency-owner side unusable on a phone. The client portal's nav is a horizontal scroll strip and works fine on mobile.

⚠ **Loading states / skeleton loaders** — one shared skeleton covers all of `/dashboard/**`; the entire `/client/(portal)/**` tree (where real users — your clients — actually experience live API latency) has no loading state or Suspense fallback at all.

⚠ **Shopify Sessions / Conversion Rate** — both are real, computed fields, but Sessions is hardcoded to 0 (no traffic endpoint exists on non-Plus Shopify plans without ShopifyQL), which makes Conversion Rate always read 0.00% — a technical limitation, not a bug in the code, but nothing in the UI tells a client that's why, see Bugs Found below.

⚠ **New Customer %, Top Performing Channel, Revenue by Platform** (Overview dashboard) — the underlying data exists (new-customer counts, per-channel spend/ROAS, per-channel revenue), but none is surfaced as its own explicitly-labeled % or highlighted "top" callout the way the spec describes.

⚠ **Video Views (TikTok)** — the field exists and renders in the shared ad-report UI, but whether TikTok's actual field mapping populates it with real numbers hasn't been verified against a live TikTok account (no test account has been connected yet).

---

## Missing Features

### Critical

**No rate limiting or lockout on client login**
- What's missing: any throttle, delay, or lockout after repeated failed password attempts against the client portal.
- Why it matters: `clientLogin()` runs one DB lookup + password check with nothing else standing between an attacker and unlimited guesses against a known or guessed client username — a real account-takeover vector, not a theoretical one.
- How it should work: a per-username and per-IP attempt counter with exponential backoff or a hard lockout after ~5-10 failures, ideally paired with the audit-log gap below so a lockout event is visible to the agency.
- Priority: **Critical**

**Delete client is not implemented**
- What's missing: any way to permanently remove a client/workspace.
- Why it matters: there is no offboarding path at all — once a client is added, it exists forever. For a commercial product this is a basic lifecycle requirement, and if it's ever added carelessly, most of the workspace-scoped tables cascade-delete automatically (contacts, tasks, connections, client logins), so it needs to ship with a confirmation step, not be added as an afterthought.
- How it should work: a confirm-to-delete flow on the client card, ideally soft-delete first (there's already an unused `archivedAt` column ready for this) with hard-delete as a separate, rarer action.
- Priority: **Critical**

**Edit client is not implemented**
- What's missing: any way to change a client's name/details after creation.
- Why it matters: a typo or a client rebrand can never be corrected without going directly into the database.
- How it should work: a straightforward update form mirroring the existing create form.
- Priority: **Critical**

**Clients-page revenue preview reads from a table nothing writes to anymore**
- What's missing: this is a live bug, not an unbuilt feature — see Bugs Found below for detail.
- Priority: **Critical**

### High

**Suspend a client without deleting them**
- What's missing: a workspace-level active/suspended status. Today only the *login* can be disabled — the workspace itself has no on/off switch, and the "Active" badge on the clients page is a hardcoded label, not backed by real state.
- Why it matters: pausing a client relationship (non-payment, offboarding in progress, dispute) currently has no clean middle ground between "fully active" and "delete everything."
- How it should work: use the already-present but unused `archivedAt`/status column on `workspaces`, gate dashboard access on it the same way client-login status already gates the portal.
- Priority: **High**

**Search and filter the client list**
- What's missing: both are entirely absent from the clients page.
- Why it matters: the product's whole premise is managing *multiple* clients from one dashboard — this stops scaling past a handful of clients.
- How it should work: a text search on name plus filters for connection status/provider.
- Priority: **High**

**No audit trail for logins or connection changes**
- What's missing: client login/logout events and every provider connect/disconnect are never written to the audit log — only the original CRM actions (contact/task/workspace creation) are.
- Why it matters: if the login-brute-force gap above is ever exploited, or an admin connects the wrong ad account to the wrong client, there's currently no record of it happening.
- How it should work: add audit rows to `clientLogin`, `clientLogoutAction`, and every `connect*`/OAuth callback, mirroring the pattern already used for CRM writes.
- Priority: **High**

**Meta: Ad Sets and Ads (only Campaign-level data exists)**
- What's missing: any breakdown below the campaign level.
- Why it matters: agencies manage budgets and creative at the ad-set and ad level daily — campaign-only rollups hide exactly where performance problems usually live.
- How it should work: add `adSetId`/`adId`-scoped queries to the Meta client, with a drill-down from the campaign table.
- Priority: **High**

**Meta: Audience Breakdown (Age, Gender, Placement, Country) — none implemented**
- Why it matters: explicitly requested and one of the more commonly-checked reports in any real ad audit.
- How it should work: Meta's Insights API supports `breakdowns` params for all four dimensions in one additional query per report.
- Priority: **High**

**Google Ads: Search Terms, Keywords, Negative Keywords, Quality Score, Device/Location breakdown — none implemented**
- Why it matters: this is a large share of what actually managing a Google Ads account looks like day to day; right now the Google Ads dashboard only shows campaign-level spend/conversion numbers, which is a fraction of the platform's own reporting depth.
- How it should work: each needs its own GAQL query against `keyword_view`/`search_term_view`/segment-level resources — a meaningfully sized follow-on build, not a quick add.
- Priority: **High**

**Shopify: no product-level data at all (Top Products, Top Collections, Products Sold, Inventory, Discount Usage)**
- Why it matters: the Shopify connector currently only reads order totals — no line items, no product references, no discount codes. A commerce dashboard with zero product visibility is a significant gap for a channel this central to the product.
- How it should work: extend `fetchShopifyDailyFacts` to also request `line_items`/`discount_codes` fields on the existing orders call (no new scope needed) and add product/collection lookups (needs `read_products`).
- Priority: **High**

**No billing/subscription management**
- Why it matters: explicitly requested, and relevant specifically because this is being evaluated as a sellable SaaS product — there is currently zero code for plans, payment, or subscription state (`organizations.plan` is a free-text column nothing ever reads or writes).
- How it should work: a Stripe (or similar) integration gating dashboard access on subscription status.
- Priority: **High**

**Admin dashboard is not usable on mobile**
- Why it matters: explicitly requested ("Mobile Friendly"), and the agency-owner side is the one that's actually broken (the client portal is fine).
- How it should work: a collapsible drawer nav below the `md:` breakpoint.
- Priority: **High**

### Medium

- **Pagination and sorting** — absent everywhere; every list (clients, campaigns) renders unpaginated and unsorted. Fine at today's scale, will not stay fine.
- **CSV/PDF export** — neither exists anywhere in the codebase.
- **TikTok: Average Watch Time, Top Videos, Top Creatives, Audience** — none implemented; TikTok's dashboard is the thinnest of the three ad platforms today.
- **Meta: Hourly Trend, Creative Performance** — only daily granularity exists; no creative-level (image/video asset) performance anywhere.
- **Reset-password UX** — functions today (see Partially Completed) but deserves its own explicit flow rather than reusing the create-login form.
- **Session idle timeout** — client sessions are a flat 30-day absolute expiry with no inactivity-based shortening.
- **Loading states on the client portal** — see Partially Completed; the tree most exposed to live-API latency has the least loading-state coverage.
- **Marketing Funnel visualization, Profit/COGS calculation** — funnel-stage *numbers* exist per ad channel, but no unified funnel diagram blending all channels + store exists, and no profit calculation exists anywhere (net-after-ad-spend is explicitly documented as "before COGS/shipping").
- **Global connected-accounts view isn't labeled by client** — see Partially Completed.

### Low

- **Toast/notification system** — only inline per-form success/error text exists; no app-wide notification system.
- **GA4, Google Tag Manager, Meta Conversions API, Shopify Storefront API** — none implemented. None of these were part of the original "4 live connectors" scope, but they were in your spec, so flagged here for completeness.
- **System/error logs UI** — no admin-facing view of application-level logs or errors (distinct from the business audit log).
- **Lazy loading, bundle-size configuration** — no `next/dynamic` usage, no bundle analyzer configured. Image optimization is moot — the app currently renders no raster images at all (icons are SVG components), so there's nothing to optimize yet.

---

## Bugs Found

**1. Clients-page revenue/order preview always shows stale data in production — Severity: Critical**
- Steps to reproduce: connect a real Shopify store to any client (non-demo mode), let a few real orders come in, then open `/dashboard/clients`.
- Expected behavior: each client card's "Net revenue (30d)" / "Orders (30d)" reflects real recent sales, the same live numbers the client's own Shopify page shows.
- Actual behavior: it will show ₹0 / 0 orders for every client, always. `clients/page.tsx:24` calls `getShopDaily()`, which in non-demo mode reads the `shop_sales_daily` database table (`queries.ts:96-106`) — a table nothing has written to since Shopify moved to on-demand live pulls this session. This is the exact same class of bug I found and fixed in the AI Copilot page earlier in this project; this instance in the clients roster was never updated and still has it.
- Fix: swap in `getLiveShopifyReport` the same way `shopify/report.tsx` and `overview/report.tsx` already do — I can make this change now if you'd like.

**2. Shopify Conversion Rate reads a misleading 0.00% with no explanation — Severity: High**
- Steps to reproduce: connect any real Shopify store and open its dashboard.
- Expected behavior: either a real conversion rate, or a clear indicator that this number isn't available on the store's current Shopify plan.
- Actual behavior: it silently shows 0.00%, identical to what a genuinely broken store would show. The KPI card's hover tooltip describes the metric normally, with no caveat that Sessions data isn't available without a ShopifyQL Plus-tier connection. A client glancing at this could reasonably think their store's conversion has completely collapsed.
- Fix: either suppress this card when sessions data is unavailable, or add an explicit "not available on this plan" state instead of a bare 0%. The same applies to Google Ads' Reach/funnel fields and TikTok's Revenue/funnel fields, which have the identical silent-zero pattern.

**3. "Active" badge on the clients page is not backed by real data — Severity: Low**
- Steps to reproduce: open `/dashboard/clients`.
- Expected behavior: a status badge reflects actual client state.
- Actual behavior: every client card shows a hardcoded "Active" badge (`clients/page.tsx:46`) regardless of any real status, because no workspace-level status field is ever set. Not exploitable, but it visually implies a status system that doesn't exist yet.

**4. Clients-page N+1 query pattern — Severity: Low (performance, not correctness)**
- Steps to reproduce: add ~30+ clients and load `/dashboard/clients`.
- Expected behavior: one batched query for all clients' revenue previews.
- Actual behavior: `clients/page.tsx:22-27` fires one separate `getShopDaily` call per workspace in a `Promise.all(map(...))` rather than a single `IN`-clause query — page load time will scale linearly with client count. Compounds with bug #1 above once that's fixed and real queries start running.

---

## Security Issues

| Issue | Risk Level | Recommendation |
|---|---|---|
| No rate limiting/lockout on client login | **Critical** | Add attempt throttling before this touches a real client's credentials — see Missing Features. |
| No audit trail for auth events or connection changes | **High** | Extend the existing audit-log pattern to `clientLogin`/`clientLogoutAction`/every connect action. |
| RBAC is fully built but dormant (single fixed principal) | **Medium** | Not exploitable today since the admin side has no external access by design, but any future feature that trusts `authorize()` to filter by a *different* per-user principal should be built and tested knowing today's principal is always `agency_owner`/unrestricted. |
| Client session: 30-day absolute expiry, no idle timeout | **Low-Medium** | Consider shortening, or adding inactivity-based expiry, especially since there's no lockout to fall back on if a session cookie is ever exposed. |
| JWTs are not used (opaque DB-backed tokens instead) | **Informational, not a finding** | Your spec asked for JWTs; the actual mechanism (random token, SHA-256 hashed, looked up server-side, deletable on logout) is arguably *better* than a JWT here, since it's instantly revocable rather than valid-until-expiry. Flagged only because it doesn't literally match the spec's wording. |

Everything else checked — tenant isolation, IDOR protection, CSRF, XSS, SQL injection, encrypted passwords, secure cookie flags — came back clean with no findings. This is a genuinely strong security baseline for the pieces it covers; the gaps above are about breadth (auth logging, brute-force protection) rather than the core isolation model being weak.

---

## UX Improvements

- Add a mobile nav drawer for the admin dashboard — right now it's the one surface in the whole app that doesn't work on a phone.
- Extend loading states/skeletons to the client portal, which is where live-API latency is actually felt by real users.
- Add search and pagination to the clients list before it's tested with more than a handful of real clients.
- Label the global connected-accounts view in Settings by client name, not just by ad-account name.
- Add an explicit "data not available on this plan/setup" state for the handful of metrics that can silently read zero (Shopify sessions, Google Ads reach, TikTok revenue) instead of letting them look like a real zero.
- A lightweight toast system for action feedback (connect/disconnect/save) would read as more polished than inline-only messages, though inline messages do already work.

---

## Final Verdict

**Beta Ready**

The parts that are genuinely hard to get right — real live data from four separate ad/commerce platforms, tenant isolation that actually holds up under inspection, encrypted credentials, IDOR-safe queries, working OAuth against Meta/Google/TikTok/Shopify — are all done, and done well. That's not a small thing; a lot of products at this stage fake the integrations or hand-wave the isolation model, and this one doesn't.

What keeps it from "Ready for Production" as a commercial, sell-to-other-agencies SaaS: you can't yet edit or delete a client, there's no rate limiting on the one real login system in the app, there's a live bug currently showing every client's revenue as zero on the roster page, and the two most detail-hungry integrations (Google Ads, Shopify) are missing the specific data agencies actually go looking for (keywords, audience breakdowns, product-level sales). None of these are architecturally hard to fix — they're straightforwardly buildable — but they're real gaps between "works for me running my own agency's clients through it" and "safe to charge strangers money for."

For your own agency's internal use with clients you're actively managing yourself, this is solid enough to run real clients through today, with the Critical items above addressed first — especially the login rate-limiting and the clients-page revenue bug.
