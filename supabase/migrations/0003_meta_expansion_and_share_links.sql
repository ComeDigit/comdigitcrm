-- ============================================================
-- ComeDigit CRM — Meta metrics expansion + public share links
-- Run this in the Supabase SQL editor against the already-provisioned
-- database (setup_all.sql / 0002_rls.sql already applied). Safe to run
-- once; every ADD COLUMN below is additive and defaults existing rows to 0.
-- ============================================================

-- ---------- ad_insights_daily: full Meta metrics expansion ----------

alter table "ad_insights_daily"
  add column if not exists "inline_link_clicks" bigint default 0 not null,
  add column if not exists "outbound_clicks" bigint default 0 not null,
  add column if not exists "unique_clicks" bigint default 0 not null,
  add column if not exists "landing_page_views" bigint default 0 not null,
  add column if not exists "page_engagements" bigint default 0 not null,
  add column if not exists "video_thruplays" bigint default 0 not null,
  add column if not exists "video_p50" bigint default 0 not null,
  add column if not exists "video_p75" bigint default 0 not null,
  add column if not exists "video_p100" bigint default 0 not null,
  add column if not exists "view_content" integer default 0 not null,
  add column if not exists "add_to_cart" integer default 0 not null,
  add column if not exists "initiate_checkout" integer default 0 not null,
  add column if not exists "add_payment_info" integer default 0 not null,
  add column if not exists "leads" integer default 0 not null;

-- ---------- campaigns: quality/engagement/conversion rankings ----------

alter table "campaigns"
  add column if not exists "quality_ranking" text,
  add column if not exists "engagement_rate_ranking" text,
  add column if not exists "conversion_rate_ranking" text;

-- ---------- share_links: public, no-login report links ----------
-- Only the SHA-256 hash of each token is stored — the raw value is shown
-- once at creation time and never persisted (same pattern as
-- invites.token_hash). Revocation is a soft delete via revoked_at.

create table if not exists "share_links" (
  "id" uuid primary key default gen_random_uuid() not null,
  "org_id" uuid not null,
  "workspace_id" uuid not null,
  "provider" "provider" not null,
  "label" text,
  "token_hash" text not null,
  "created_at" timestamp with time zone default now() not null,
  "last_viewed_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);

-- Named to match drizzle's convention (setup_all.sql uses the same names
-- for a fresh install) so constraint names stay identical either way.
alter table "share_links" drop constraint if exists "share_links_org_id_organizations_id_fk";
alter table "share_links" add constraint "share_links_org_id_organizations_id_fk"
  foreign key ("org_id") references "public"."organizations"("id") on delete cascade;
alter table "share_links" drop constraint if exists "share_links_workspace_id_workspaces_id_fk";
alter table "share_links" add constraint "share_links_workspace_id_workspaces_id_fk"
  foreign key ("workspace_id") references "public"."workspaces"("id") on delete cascade;

create unique index if not exists "share_links_token_hash_uq" on "share_links" using btree ("token_hash");
create index if not exists "share_links_workspace_idx" on "share_links" using btree ("workspace_id");
create index if not exists "share_links_org_idx" on "share_links" using btree ("org_id");

alter table public.share_links enable row level security;

-- Same shape as every other tenant table's policy: agency staff with
-- workspace access can read/manage; the public /share/:provider/:token
-- route is served by server code using the direct (RLS-bypassing)
-- connection and verifies the token itself, not through these policies.
create policy share_links_select on public.share_links
  for select using (
    org_id = public.current_org_id() and public.has_workspace_access(workspace_id)
  );
create policy share_links_write on public.share_links
  for all using (
    org_id = public.current_org_id()
    and public.has_workspace_access(workspace_id)
    and (public.current_membership()).role in
      ('super_admin','agency_owner','manager','marketing_executive','media_buyer')
  );
