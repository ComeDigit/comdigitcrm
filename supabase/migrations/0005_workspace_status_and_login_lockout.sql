-- ============================================================
-- ComeDigit CRM — Workspace suspend/reactivate + client-login lockout
-- Run this in the Supabase SQL editor against the already-provisioned
-- database (0002_rls.sql / 0003_meta_expansion_and_share_links.sql /
-- 0004_client_portal.sql already applied). Safe to run once; every
-- ADD COLUMN below is additive and defaults existing rows sanely.
-- ============================================================

-- ---------- workspaces: suspend ≠ delete ----------
-- "suspended" is a normal, reversible, admin-toggled pause (client access
-- blocked, data untouched) — distinct from archived_at (soft-delete). A
-- workspace can be suspended without being archived; existing rows default
-- to 'active' so nothing already provisioned is affected.

do $$ begin
  create type "workspace_status" as enum ('active', 'suspended');
exception
  when duplicate_object then null;
end $$;

alter table "workspaces"
  add column if not exists "status" "workspace_status" default 'active' not null;

-- ---------- client_users: login rate limiting ----------
-- failed_attempts increments on each bad password and resets to 0 on a
-- successful login. Once it crosses the threshold (see
-- src/features/client-portal/actions.ts), locked_until is set to a future
-- timestamp and login is refused — even with the correct password — until
-- that time passes. Per-account lock, not IP-based.

alter table "client_users"
  add column if not exists "failed_attempts" integer default 0 not null,
  add column if not exists "locked_until" timestamp with time zone;
