-- ============================================================
-- ComeDigit CRM — Row Level Security
-- Applied AFTER drizzle-generated DDL (0001). RLS is the floor;
-- app code additionally scopes every query explicitly.
-- ============================================================

-- ---------- helper functions (security definer, stable) ----------

-- Current user's org id from JWT custom claims (stamped by auth hook).
create or replace function public.current_org_id()
returns uuid
language sql stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'org_id', '')::uuid
$$;

-- Membership row for current user in current org (cached per statement).
create or replace function public.current_membership()
returns public.memberships
language sql stable security definer set search_path = public
as $$
  select m.* from public.memberships m
  where m.user_id = auth.uid() and m.org_id = public.current_org_id()
  limit 1
$$;

-- Does the current user have access to a workspace?
-- workspace_ids null => all workspaces in the org (agency staff).
create or replace function public.has_workspace_access(ws uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.org_id = public.current_org_id()
      and (
        m.workspace_ids is null
        or m.workspace_ids ? ws::text
      )
  )
$$;

-- ---------- enable RLS on every tenant table ----------

alter table public.organizations          enable row level security;
alter table public.workspaces             enable row level security;
alter table public.profiles               enable row level security;
alter table public.memberships            enable row level security;
alter table public.invites                enable row level security;
alter table public.integration_connections enable row level security;
alter table public.integration_secrets    enable row level security; -- no policies: service-role only
alter table public.job_queue              enable row level security; -- no policies: service-role only
alter table public.sync_cursors           enable row level security; -- no policies: service-role only
alter table public.webhook_inbox          enable row level security; -- no policies: service-role only
alter table public.audit_log              enable row level security;
alter table public.contacts               enable row level security;
alter table public.deals                  enable row level security;
alter table public.tasks                  enable row level security;
alter table public.notes                  enable row level security;
alter table public.invoices               enable row level security;
alter table public.campaigns              enable row level security;
alter table public.ad_insights_daily      enable row level security;
alter table public.shop_sales_daily       enable row level security;
alter table public.fx_rates_daily         enable row level security;

-- ---------- policies ----------

-- organizations: members can read their own org; only owners update.
create policy org_select on public.organizations
  for select using (id = public.current_org_id());
create policy org_update on public.organizations
  for update using (
    id = public.current_org_id()
    and (public.current_membership()).role in ('super_admin','agency_owner')
  );

-- profiles: users see profiles of people in their org; edit only self.
create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.memberships m
      where m.user_id = profiles.id and m.org_id = public.current_org_id()
    )
  );
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid());

-- memberships: visible within org; managed by owners/admins.
create policy memberships_select on public.memberships
  for select using (org_id = public.current_org_id());
create policy memberships_write on public.memberships
  for all using (
    org_id = public.current_org_id()
    and (public.current_membership()).role in ('super_admin','agency_owner','manager')
  );

-- invites: managed by owners/admins only.
create policy invites_all on public.invites
  for all using (
    org_id = public.current_org_id()
    and (public.current_membership()).role in ('super_admin','agency_owner','manager')
  );

-- workspaces: org members with workspace access.
create policy workspaces_select on public.workspaces
  for select using (
    org_id = public.current_org_id() and public.has_workspace_access(id)
  );
create policy workspaces_write on public.workspaces
  for all using (
    org_id = public.current_org_id()
    and (public.current_membership()).role in ('super_admin','agency_owner','manager')
  );

-- integration_connections: metadata visible to workspace members;
-- mutations via owners/managers. Secrets table has NO policies at all.
create policy connections_select on public.integration_connections
  for select using (
    org_id = public.current_org_id() and public.has_workspace_access(workspace_id)
  );
create policy connections_write on public.integration_connections
  for all using (
    org_id = public.current_org_id()
    and public.has_workspace_access(workspace_id)
    and (public.current_membership()).role in ('super_admin','agency_owner','manager','media_buyer')
  );

-- audit_log: readable by admins in-org; INSERT only via service role.
create policy audit_select on public.audit_log
  for select using (
    org_id = public.current_org_id()
    and (public.current_membership()).role in ('super_admin','agency_owner','manager')
  );

-- Generic tenant-data macro applied to CRM + metrics tables:
-- SELECT: workspace access. WRITE: workspace access + non-read-only role.
do $$
declare
  t text;
begin
  foreach t in array array[
    'contacts','deals','tasks','notes','invoices',
    'campaigns','ad_insights_daily','shop_sales_daily'
  ]
  loop
    execute format($f$
      create policy %1$I_select on public.%1$I
        for select using (
          org_id = public.current_org_id()
          and (workspace_id is null or public.has_workspace_access(workspace_id))
        );
      create policy %1$I_write on public.%1$I
        for all using (
          org_id = public.current_org_id()
          and (workspace_id is null or public.has_workspace_access(workspace_id))
          and (public.current_membership()).role not in ('read_only','client')
        );
    $f$, t);
  end loop;
end $$;

-- fx rates: global reference data — readable by any authenticated user.
create policy fx_select on public.fx_rates_daily
  for select using (auth.role() = 'authenticated');

-- ---------- claims hook ----------
-- Supabase Auth "custom access token" hook: stamp org_id into JWT.
-- Configure in Dashboard → Auth → Hooks after linking the project.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
as $$
declare
  claims jsonb;
  user_org uuid;
begin
  select org_id into user_org
  from public.memberships
  where user_id = (event->>'user_id')::uuid
  order by created_at asc
  limit 1;

  claims := coalesce(event->'claims', '{}'::jsonb);
  claims := jsonb_set(
    claims,
    '{app_metadata,org_id}',
    coalesce(to_jsonb(user_org::text), 'null'::jsonb)
  );
  return jsonb_set(event, '{claims}', claims);
end;
$$;
