-- ============================================================
-- ComeDigit CRM — Client portal logins
-- Run this in the Supabase SQL editor against the already-provisioned
-- database (setup_all.sql / 0002_rls.sql / 0003_meta_expansion_and_share_links.sql
-- already applied). Safe to run once.
-- ============================================================

-- ---------- client_users: one login per client workspace ----------
-- Passwords are never stored — only a salted scrypt hash (see
-- src/lib/auth/client-session.ts). Username is globally unique because
-- login doesn't specify a workspace up front; the username alone
-- determines which workspace the session resolves to.

do $$ begin
  create type "client_user_status" as enum ('active', 'disabled');
exception
  when duplicate_object then null;
end $$;

create table if not exists "client_users" (
  "id" uuid primary key default gen_random_uuid() not null,
  "org_id" uuid not null,
  "workspace_id" uuid not null,
  "username" text not null,
  "password_hash" text not null,
  "status" "client_user_status" default 'active' not null,
  "last_login_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

alter table "client_users" drop constraint if exists "client_users_org_id_organizations_id_fk";
alter table "client_users" add constraint "client_users_org_id_organizations_id_fk"
  foreign key ("org_id") references "public"."organizations"("id") on delete cascade;
alter table "client_users" drop constraint if exists "client_users_workspace_id_workspaces_id_fk";
alter table "client_users" add constraint "client_users_workspace_id_workspaces_id_fk"
  foreign key ("workspace_id") references "public"."workspaces"("id") on delete cascade;

create unique index if not exists "client_users_username_uq" on "client_users" using btree ("username");
create index if not exists "client_users_workspace_idx" on "client_users" using btree ("workspace_id");
create index if not exists "client_users_org_idx" on "client_users" using btree ("org_id");

-- ---------- client_sessions: hashed opaque session tokens ----------
-- Same pattern as share_links.token_hash — the raw token lives only in
-- the httpOnly cookie; only its SHA-256 hash is stored here. The
-- workspace a /client/* page renders is ALWAYS resolved by looking up
-- this table server-side, never from a client-editable cookie/param.

create table if not exists "client_sessions" (
  "id" uuid primary key default gen_random_uuid() not null,
  "client_user_id" uuid not null,
  "token_hash" text not null,
  "expires_at" timestamp with time zone not null,
  "created_at" timestamp with time zone default now() not null
);

alter table "client_sessions" drop constraint if exists "client_sessions_client_user_id_client_users_id_fk";
alter table "client_sessions" add constraint "client_sessions_client_user_id_client_users_id_fk"
  foreign key ("client_user_id") references "public"."client_users"("id") on delete cascade;

create unique index if not exists "client_sessions_token_hash_uq" on "client_sessions" using btree ("token_hash");
create index if not exists "client_sessions_client_user_idx" on "client_sessions" using btree ("client_user_id");

-- ---------- RLS: service-role only, same as integration_secrets/job_queue ----------
-- Password hashes and session tokens are never read through the anon/
-- authenticated Supabase client — only through the app's direct
-- (RLS-bypassing) service-role connection. Enabling RLS with no policies
-- blocks every other access path outright.

alter table public.client_users    enable row level security;
alter table public.client_sessions enable row level security;
