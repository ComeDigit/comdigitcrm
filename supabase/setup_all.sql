CREATE TYPE "public"."member_role" AS ENUM('super_admin', 'agency_owner', 'manager', 'marketing_executive', 'media_buyer', 'seo_manager', 'content_manager', 'sales', 'client', 'read_only');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('active', 'paused', 'reauth_required', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('shopify', 'meta', 'google_ads', 'ga4', 'tiktok', 'search_console', 'merchant_center', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."deal_stage" AS ENUM('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'paid', 'overdue', 'void');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'review', 'done');--> statement-breakpoint
CREATE TYPE "public"."entity_status" AS ENUM('active', 'paused', 'archived', 'deleted');--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'read_only' NOT NULL,
	"workspace_ids" jsonb,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'read_only' NOT NULL,
	"workspace_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"currency_code" text DEFAULT 'INR' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"avatar_url" text,
	"claims_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"brand_color" text,
	"website" text,
	"currency_code" text DEFAULT 'INR' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"granted_scopes" jsonb DEFAULT '[]'::jsonb,
	"currency_code" text,
	"timezone" text,
	"last_sync_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_secrets" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"vault_secret_id" uuid,
	"encrypted_payload" text,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid,
	"connection_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"connection_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider" NOT NULL,
	"event_id" text NOT NULL,
	"topic" text NOT NULL,
	"connection_id" uuid,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"title" text,
	"email" text,
	"phone" text,
	"tax_ids" jsonb DEFAULT '{}'::jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid,
	"title" text NOT NULL,
	"stage" "deal_stage" DEFAULT 'lead' NOT NULL,
	"value_minor" bigint DEFAULT 0 NOT NULL,
	"currency_code" text DEFAULT 'INR' NOT NULL,
	"contact_id" uuid,
	"owner_id" uuid,
	"expected_close_date" date,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency_code" text DEFAULT 'INR' NOT NULL,
	"issued_on" date,
	"due_on" date,
	"paid_at" timestamp with time zone,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"assignee_id" uuid,
	"due_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_insights_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"date" date NOT NULL,
	"spend_minor" bigint DEFAULT 0 NOT NULL,
	"revenue_minor" bigint DEFAULT 0 NOT NULL,
	"currency_code" text DEFAULT 'INR' NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"purchases" integer DEFAULT 0 NOT NULL,
	"reach" bigint DEFAULT 0 NOT NULL,
	"video_views_3s" bigint DEFAULT 0 NOT NULL,
	"video_plays" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"objective" text,
	"daily_budget_minor" bigint,
	"currency_code" text DEFAULT 'INR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates_daily" (
	"date" date NOT NULL,
	"currency_code" text NOT NULL,
	"rate_micros" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_sales_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"date" date NOT NULL,
	"gross_sales_minor" bigint DEFAULT 0 NOT NULL,
	"net_sales_minor" bigint DEFAULT 0 NOT NULL,
	"refunds_minor" bigint DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"new_customers" integer DEFAULT 0 NOT NULL,
	"returning_customers" integer DEFAULT 0 NOT NULL,
	"sessions" bigint DEFAULT 0 NOT NULL,
	"currency_code" text DEFAULT 'INR' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_secrets" ADD CONSTRAINT "integration_secrets_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD CONSTRAINT "ad_insights_daily_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_org_idx" ON "invites" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_org_slug_uq" ON "workspaces" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "workspaces_org_idx" ON "workspaces" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_org_created_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_ws_provider_account_uq" ON "integration_connections" USING btree ("workspace_id","provider","external_account_id");--> statement-breakpoint
CREATE INDEX "connections_org_idx" ON "integration_connections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "job_queue_claim_idx" ON "job_queue" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "job_queue_ws_idx" ON "job_queue" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_queue_dedupe_uq" ON "job_queue" USING btree ("dedupe_key") WHERE status = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "sync_cursors_uq" ON "sync_cursors" USING btree ("connection_id","resource");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_inbox_event_uq" ON "webhook_inbox" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "contacts_ws_idx" ON "contacts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "deals_org_stage_idx" ON "deals" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX "invoices_org_status_idx" ON "invoices" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "notes_ws_idx" ON "notes" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tasks_ws_status_idx" ON "tasks" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_insights_natural_uq" ON "ad_insights_daily" USING btree ("campaign_id","date");--> statement-breakpoint
CREATE INDEX "ad_insights_ws_date_idx" ON "ad_insights_daily" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_natural_uq" ON "campaigns" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "campaigns_ws_provider_idx" ON "campaigns" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_uq" ON "fx_rates_daily" USING btree ("date","currency_code");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_sales_natural_uq" ON "shop_sales_daily" USING btree ("connection_id","date");--> statement-breakpoint
CREATE INDEX "shop_sales_ws_date_idx" ON "shop_sales_daily" USING btree ("workspace_id","date");-- ============================================================
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
