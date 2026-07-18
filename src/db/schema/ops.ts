import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { organizations, workspaces } from "./tenancy";

/**
 * Operational core: integration connections, job queue, sync cursors,
 * webhook inbox, audit log. These tables power reliability features
 * (API-failure alerts, resumable sync) — they are product surface, not
 * just plumbing.
 *
 * SECURITY: integration_secrets has NO RLS grants (service-role only) —
 * see migration. Connection *metadata* is tenant-visible; tokens never are.
 */

export const providerEnum = pgEnum("provider", [
  "shopify",
  "meta",
  "google_ads",
  "ga4",
  "tiktok",
  "search_console",
  "merchant_center",
  "whatsapp",
]);

export const connectionStatusEnum = pgEnum("connection_status", [
  "active",
  "paused",
  "reauth_required",
  "error",
  "disconnected",
]);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    /** Provider-side account identifier (ad account id, shop domain…). */
    externalAccountId: text("external_account_id").notNull(),
    displayName: text("display_name").notNull(),
    status: connectionStatusEnum("status").notNull().default("active"),
    /** OAuth scopes actually granted — feature-gate on these. */
    grantedScopes: jsonb("granted_scopes").$type<string[]>().default([]),
    /** Provider account currency (may differ from workspace currency). */
    currencyCode: text("currency_code"),
    /** Provider account timezone — daily facts aggregate in THIS zone. */
    timezone: text("timezone"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("connections_ws_provider_account_uq").on(
      t.workspaceId,
      t.provider,
      t.externalAccountId,
    ),
    index("connections_org_idx").on(t.orgId),
  ],
);

/**
 * Encrypted credentials, separated from metadata. Values are encrypted
 * with Supabase Vault before insert; this table gets NO RLS SELECT grant
 * for authenticated users. Service-role only.
 */
export const integrationSecrets = pgTable("integration_secrets", {
  connectionId: uuid("connection_id")
    .primaryKey()
    .references(() => integrationConnections.id, { onDelete: "cascade" }),
  /** Vault secret id holding the access/refresh token bundle. */
  vaultSecretId: uuid("vault_secret_id"),
  /** Fallback envelope-encrypted payload when Vault is unavailable locally. */
  encryptedPayload: text("encrypted_payload"),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const jobQueue = pgTable(
  "job_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** e.g. "sync.meta.insights", "report.weekly", "automation.evaluate" */
    type: text("type").notNull(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id"),
    connectionId: uuid("connection_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatusEnum("status").notNull().default("queued"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    /** Dedupe key: identical queued job is not enqueued twice. */
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("job_queue_claim_idx").on(t.status, t.runAt),
    index("job_queue_ws_idx").on(t.workspaceId),
    uniqueIndex("job_queue_dedupe_uq")
      .on(t.dedupeKey)
      .where(sql`status = 'queued'`),
  ],
);

/** Resumable incremental sync position per connection+resource. */
export const syncCursors = pgTable(
  "sync_cursors",
  {
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    /** e.g. "orders", "insights.daily", "campaigns" */
    resource: text("resource").notNull(),
    cursor: jsonb("cursor").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sync_cursors_uq").on(t.connectionId, t.resource)],
);

/** Raw webhook inbox: verify → insert → 200 → process async. */
export const webhookInbox = pgTable(
  "webhook_inbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: providerEnum("provider").notNull(),
    /** Provider idempotency/event id — duplicates are ignored. */
    eventId: text("event_id").notNull(),
    topic: text("topic").notNull(),
    connectionId: uuid("connection_id"),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_inbox_event_uq").on(t.provider, t.eventId)],
);

/**
 * Public, no-login share links. A share link exposes ONE workspace's ONE
 * provider report at /share/:provider/:token — never the full dashboard,
 * never the workspace switcher, never another client's data. The raw token
 * is generated once at creation time and handed to the caller; only its
 * SHA-256 hash is stored here (same pattern as `invites.tokenHash`), so a
 * database leak can't be used to mint working share URLs. Revoke by setting
 * revokedAt — rows are never deleted, so view history survives revocation.
 */
export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    /** Optional human label shown only in the internal management list. */
    label: text("label"),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("share_links_token_hash_uq").on(t.tokenHash),
    index("share_links_workspace_idx").on(t.workspaceId),
    index("share_links_org_idx").on(t.orgId),
  ],
);

/** Append-only audit log, written by mutation helpers — never by hand. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id"),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

export const clientUserStatusEnum = pgEnum("client_user_status", ["active", "disabled"]);

/**
 * Client portal login — the fourth access tier alongside the internal team
 * dashboard, the (currently no-op) member system, and public share links.
 * One row per client login, tied to exactly ONE workspace: logging in as
 * this user can only ever resolve that workspace, never any other, and
 * never the cross-client switcher the internal dashboard has. Passwords
 * are never stored — only a salted hash (see lib/auth/client-session.ts).
 * Username is globally unique because login doesn't specify a workspace
 * up front — the username alone determines which one you land in.
 */
export const clientUsers = pgTable(
  "client_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    status: clientUserStatusEnum("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("client_users_username_uq").on(t.username),
    index("client_users_workspace_idx").on(t.workspaceId),
    index("client_users_org_idx").on(t.orgId),
  ],
);

/**
 * Client portal sessions — same hashed-opaque-token pattern as share_links:
 * the raw token lives only in the httpOnly cookie, only its SHA-256 hash is
 * persisted here. A session is looked up on every /client/* page load to
 * resolve which workspace to render — the workspace is NEVER taken from a
 * client-editable cookie or query param, only from this server-side lookup,
 * so a client can't tamper their way into seeing another client's data.
 */
export const clientSessions = pgTable(
  "client_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientUserId: uuid("client_user_id")
      .notNull()
      .references(() => clientUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("client_sessions_token_hash_uq").on(t.tokenHash),
    index("client_sessions_client_user_idx").on(t.clientUserId),
  ],
);
