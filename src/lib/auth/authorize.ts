import "server-only";

/**
 * THE single authorization code path. Every server action and route
 * handler checks permissions through authorize() — never inline role
 * checks. RLS is the database floor; this is the application gate.
 */

export type Role =
  | "super_admin"
  | "agency_owner"
  | "manager"
  | "marketing_executive"
  | "media_buyer"
  | "seo_manager"
  | "content_manager"
  | "sales"
  | "client"
  | "read_only";

export type Action =
  | "org.manage"
  | "workspace.manage"
  | "members.manage"
  | "connections.manage"
  | "crm.read"
  | "crm.write"
  | "metrics.read"
  | "reports.generate"
  | "share_links.manage"
  | "client_users.manage"
  | "automations.manage"
  | "billing.manage";

/** Role → allowed actions. Explicit allow-list; nothing implicit. */
const GRANTS: Record<Role, ReadonlySet<Action>> = {
  super_admin: new Set<Action>([
    "org.manage", "workspace.manage", "members.manage", "connections.manage",
    "crm.read", "crm.write", "metrics.read", "reports.generate", "share_links.manage",
    "client_users.manage", "automations.manage", "billing.manage",
  ]),
  agency_owner: new Set<Action>([
    "org.manage", "workspace.manage", "members.manage", "connections.manage",
    "crm.read", "crm.write", "metrics.read", "reports.generate", "share_links.manage",
    "client_users.manage", "automations.manage", "billing.manage",
  ]),
  manager: new Set<Action>([
    "workspace.manage", "members.manage", "connections.manage",
    "crm.read", "crm.write", "metrics.read", "reports.generate", "share_links.manage",
    "client_users.manage", "automations.manage",
  ]),
  marketing_executive: new Set<Action>([
    "crm.read", "crm.write", "metrics.read", "reports.generate", "share_links.manage",
    "client_users.manage",
  ]),
  media_buyer: new Set<Action>([
    "connections.manage", "crm.read", "metrics.read", "reports.generate", "share_links.manage",
  ]),
  seo_manager: new Set<Action>(["crm.read", "metrics.read", "reports.generate"]),
  content_manager: new Set<Action>(["crm.read", "crm.write"]),
  sales: new Set<Action>(["crm.read", "crm.write"]),
  client: new Set<Action>(["metrics.read", "reports.generate"]),
  read_only: new Set<Action>(["crm.read", "metrics.read"]),
};

export interface Principal {
  userId: string;
  orgId: string;
  role: Role;
  /** null = every workspace in org. */
  workspaceIds: string[] | null;
}

export class AuthorizationError extends Error {
  readonly status = 403;
  constructor(action: Action) {
    super(`Not authorized: ${action}`);
  }
}

export function can(principal: Principal, action: Action): boolean {
  return GRANTS[principal.role].has(action);
}

export function canAccessWorkspace(
  principal: Principal,
  workspaceId: string,
): boolean {
  return (
    principal.workspaceIds === null ||
    principal.workspaceIds.includes(workspaceId)
  );
}

/** Throws unless the principal may perform `action` (optionally in a workspace). */
export function authorize(
  principal: Principal,
  action: Action,
  workspaceId?: string,
): void {
  if (!can(principal, action)) throw new AuthorizationError(action);
  if (workspaceId && !canAccessWorkspace(principal, workspaceId)) {
    throw new AuthorizationError(action);
  }
}
