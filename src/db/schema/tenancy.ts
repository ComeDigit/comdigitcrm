import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

/**
 * Tenancy core: Organization (agency) → Workspace (client brand) → Membership.
 * Every tenant-owned table in other schema files carries orgId (+ workspaceId
 * where applicable). RLS policies live in the SQL migration; Drizzle is the
 * single source of truth for shape, SQL migration for policy.
 */

export const roleEnum = pgEnum("member_role", [
  "super_admin",
  "agency_owner",
  "manager",
  "marketing_executive",
  "media_buyer",
  "seo_manager",
  "content_manager",
  "sales",
  "client",
  "read_only",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  /** ISO 4217 display currency for org-level rollups. */
  currencyCode: text("currency_code").notNull().default("INR"),
  /** IANA timezone used for org-level reporting defaults. */
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  plan: text("plan").notNull().default("trial"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Suspend ≠ delete: "suspended" is a normal, reversible, admin-toggled
 * pause (client access blocked, data untouched) — distinct from
 * `archivedAt` below, which is the soft-delete path. A workspace can be
 * suspended without being archived, and vice versa isn't meaningful (an
 * archived workspace is already hidden everywhere).
 */
export const workspaceStatusEnum = pgEnum("workspace_status", ["active", "suspended"]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Client-brand metadata (a workspace IS one client brand). */
    brandColor: text("brand_color"),
    website: text("website"),
    currencyCode: text("currency_code").notNull().default("INR"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    status: workspaceStatusEnum("status").notNull().default("active"),
    /** Soft archive keeps history queryable. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workspaces_org_slug_uq").on(t.orgId, t.slug),
    index("workspaces_org_idx").on(t.orgId),
  ],
);

/**
 * Mirrors auth.users (Supabase). We never store credentials — only profile
 * data. `id` equals auth.users.id.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  /** Bumped on role change to force JWT claim re-issue. */
  claimsVersion: integer("claims_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("read_only"),
    /**
     * Workspace scoping: null = all workspaces in the org (agency staff);
     * array of workspace ids = restricted (e.g. a client user sees only
     * their own brand).
     */
    workspaceIds: jsonb("workspace_ids").$type<string[] | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: roleEnum("role").notNull().default("read_only"),
    workspaceIds: jsonb("workspace_ids").$type<string[] | null>(),
    /** Single-use token hash (never the raw token). */
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invites_org_idx").on(t.orgId)],
);
