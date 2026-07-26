import "server-only";
import { isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import {
  demoContacts,
  demoTasks,
  demoWorkspaces,
} from "@/features/demo-data/generator";

/**
 * CRM read facade: demo generator or live tables, one return shape.
 * Live queries are tenant-scoped by orgId (RLS is the second net).
 */

export interface ContactRow {
  id: string;
  fullName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  workspaceId: string;
}

export interface TaskRow {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "review" | "done";
  workspaceId: string | null;
  dueDate: string | null;
  assignee: string | null;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  vertical?: string;
  status: "active" | "suspended";
  website: string | null;
  archivedAt: string | null;
}

export async function getWorkspaces(orgId: string): Promise<WorkspaceRow[]> {
  if (isDemoMode) {
    return demoWorkspaces.map((w) => ({
      id: w.id,
      name: w.name,
      vertical: w.vertical,
      status: "active",
      website: null,
      archivedAt: null,
    }));
  }
  const db = getDb();
  const rows = await db.query.workspaces.findMany({
    where: (w, { eq, and, isNull }) => and(eq(w.orgId, orgId), isNull(w.archivedAt)),
    columns: { id: true, name: true, status: true, website: true, archivedAt: true },
    orderBy: (w, { asc }) => asc(w.createdAt),
  });
  return rows.map((r) => ({ ...r, archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null }));
}

/**
 * Archived (soft-deleted) clients only — the "Delete client" action never
 * hard-deletes (that would cascade-wipe contacts/tasks/invoices/connections/
 * client logins with zero recovery path); it sets archivedAt instead, and
 * this is how the clients page renders a separate "Archived" section with
 * a Restore action, matching how getWorkspaces already hides them from the
 * main roster.
 */
export async function getArchivedWorkspaces(orgId: string): Promise<WorkspaceRow[]> {
  if (isDemoMode) return [];
  const db = getDb();
  const rows = await db.query.workspaces.findMany({
    where: (w, { eq, and, isNotNull }) => and(eq(w.orgId, orgId), isNotNull(w.archivedAt)),
    columns: { id: true, name: true, status: true, website: true, archivedAt: true },
    orderBy: (w, { desc }) => desc(w.archivedAt),
  });
  return rows.map((r) => ({ ...r, archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null }));
}

export async function getContacts(orgId: string): Promise<ContactRow[]> {
  if (isDemoMode) {
    return demoContacts().map((c) => ({
      id: c.id,
      fullName: c.fullName,
      title: c.title,
      email: c.email,
      phone: c.phone,
      workspaceId: c.workspaceId,
    }));
  }
  const db = getDb();
  const rows = await db.query.contacts.findMany({
    where: (c, { eq }) => eq(c.orgId, orgId),
    orderBy: (c, { desc }) => desc(c.createdAt),
    limit: 200,
  });
  return rows.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    title: c.title,
    email: c.email,
    phone: c.phone,
    workspaceId: c.workspaceId,
  }));
}

export async function getTasks(orgId: string): Promise<TaskRow[]> {
  if (isDemoMode) {
    return demoTasks().map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      workspaceId: t.workspaceId,
      dueDate: t.dueDate,
      assignee: t.assignee,
    }));
  }
  const db = getDb();
  const rows = await db.query.tasks.findMany({
    where: (t, { eq }) => eq(t.orgId, orgId),
    orderBy: (t, { desc }) => desc(t.createdAt),
    limit: 500,
  });
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    workspaceId: t.workspaceId,
    dueDate: t.dueDate,
    assignee: null,
  }));
}
