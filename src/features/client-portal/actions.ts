"use server";

import { eq, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import { clientUsers } from "@/db/schema";
import { authorize, AuthorizationError } from "@/lib/auth/authorize";
import { getPrincipal } from "@/lib/auth/principal";
import {
  hashPassword,
  verifyPassword,
  createClientSession,
  destroyClientSession,
} from "@/lib/auth/client-session";

/**
 * Client portal — admin-managed logins (Settings page) plus the public
 * login/logout flow. One client_user per workspace via this UI (the table
 * itself allows more, but the admin form always upserts a single row per
 * workspace — keeping "one login per client" simple to reason about).
 */

export interface ActionResult {
  error?: string;
  ok?: boolean;
}

export interface ClientLoginSummary {
  id: string;
  username: string;
  status: "active" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
}

/** Admin: fetch the client login for a workspace, if one exists. */
export async function getClientLogin(workspaceId: string): Promise<ClientLoginSummary | null> {
  if (isDemoMode) return null;
  try {
    const principal = await getPrincipal();
    authorize(principal, "client_users.manage", workspaceId);
  } catch {
    return null;
  }

  const db = getDb();
  const row = await db.query.clientUsers.findFirst({
    where: (u, { eq: eqOp }) => eqOp(u.workspaceId, workspaceId),
    orderBy: (u, { desc }) => [desc(u.createdAt)],
  });
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    status: row.status,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

/**
 * Admin: create or update the ONE client login for a workspace. Username
 * is chosen by the admin (per the client's explicit preference over
 * auto-generated credentials) and must be globally unique since login
 * doesn't specify a workspace up front.
 */
export async function saveClientLogin(
  workspaceId: string,
  username: string,
  password: string,
): Promise<ActionResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to create real client logins." };
  }
  const cleanUsername = username.trim().toLowerCase();
  if (!USERNAME_RE.test(cleanUsername)) {
    return {
      error: "Username must be 3-32 characters: letters, numbers, dots, underscores, hyphens.",
    };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  try {
    const principal = await getPrincipal();
    authorize(principal, "client_users.manage", workspaceId);

    const db = getDb();

    const clash = await db.query.clientUsers.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.username, cleanUsername),
    });
    if (clash && clash.workspaceId !== workspaceId) {
      return { error: "That username is already used by another client's login." };
    }

    const existing = await db.query.clientUsers.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.workspaceId, workspaceId),
    });

    const passwordHash = hashPassword(password);

    if (existing) {
      await db
        .update(clientUsers)
        .set({ username: cleanUsername, passwordHash, status: "active", updatedAt: new Date() })
        .where(eq(clientUsers.id, existing.id));
    } else {
      await db.insert(clientUsers).values({
        orgId: principal.orgId,
        workspaceId,
        username: cleanUsername,
        passwordHash,
      });
    }

    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    return {
      error: e instanceof Error ? `Could not save login: ${e.message}` : "Unknown error.",
    };
  }
}

export async function setClientLoginStatus(
  id: string,
  workspaceId: string,
  status: "active" | "disabled",
): Promise<ActionResult> {
  if (isDemoMode) return { error: "Demo mode." };
  try {
    const principal = await getPrincipal();
    authorize(principal, "client_users.manage", workspaceId);
    const db = getDb();
    await db
      .update(clientUsers)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(clientUsers.id, id), eq(clientUsers.workspaceId, workspaceId)));
    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    return { error: "Could not update this login." };
  }
}

export async function deleteClientLogin(id: string, workspaceId: string): Promise<ActionResult> {
  if (isDemoMode) return { error: "Demo mode." };
  try {
    const principal = await getPrincipal();
    authorize(principal, "client_users.manage", workspaceId);
    const db = getDb();
    await db
      .delete(clientUsers)
      .where(and(eq(clientUsers.id, id), eq(clientUsers.workspaceId, workspaceId)));
    revalidatePath("/dashboard/settings");
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    return { error: "Could not delete this login." };
  }
}

/**
 * Public: client login form submit. Deliberately returns the SAME generic
 * error for "no such username" and "wrong password" — never reveal which
 * one to whoever's typing. On success, sets the session cookie and sends
 * the browser straight to the client's own dashboard.
 */
export async function clientLogin(username: string, password: string): Promise<ActionResult> {
  if (isDemoMode) {
    return { error: "Demo mode — the client portal needs Supabase connected." };
  }
  const cleanUsername = username.trim().toLowerCase();
  if (!cleanUsername || !password) {
    return { error: "Enter your username and password." };
  }

  const db = getDb();
  const user = await db.query.clientUsers.findFirst({
    where: (u, { eq: eqOp }) => eqOp(u.username, cleanUsername),
  });

  if (!user || user.status !== "active" || !verifyPassword(password, user.passwordHash)) {
    return { error: "Incorrect username or password." };
  }

  await createClientSession(user.id);
  await db.update(clientUsers).set({ lastLoginAt: new Date() }).where(eq(clientUsers.id, user.id));
  redirect("/client");
}

export async function clientLogoutAction(): Promise<void> {
  await destroyClientSession();
  redirect("/client/login");
}
