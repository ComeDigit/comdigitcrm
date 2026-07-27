CREATE TYPE "public"."workspace_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."client_user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "client_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" "client_user_status" DEFAULT 'active' NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"label" text,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "status" "workspace_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "inline_link_clicks" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "outbound_clicks" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "unique_clicks" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "landing_page_views" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "page_engagements" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "video_thruplays" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "video_p50" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "video_p75" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "video_p100" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "view_content" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "add_to_cart" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "initiate_checkout" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "add_payment_info" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD COLUMN "leads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "quality_ranking" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "engagement_rate_ranking" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "conversion_rate_ranking" text;--> statement-breakpoint
ALTER TABLE "client_sessions" ADD CONSTRAINT "client_sessions_client_user_id_client_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."client_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_users" ADD CONSTRAINT "client_users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_sessions_token_hash_uq" ON "client_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "client_sessions_client_user_idx" ON "client_sessions" USING btree ("client_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_users_username_uq" ON "client_users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "client_users_workspace_idx" ON "client_users" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "client_users_org_idx" ON "client_users" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_token_hash_uq" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_links_workspace_idx" ON "share_links" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "share_links_org_idx" ON "share_links" USING btree ("org_id");