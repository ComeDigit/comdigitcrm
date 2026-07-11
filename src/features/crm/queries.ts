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
}

export async function getWorkspaces(orgId: string): Promise<WorkspaceRow[]> {
  if (isDemoMode) {
    return demoWorkspaces.map((w) => ({ id: w.id, name: w.name, vertical: w.vertical }));
  }
  const db = getDb();
  const rows = await db.query.workspaces.findMany({
    where: (w, { eq, and, isNull }) => and(eq(w.orgId, orgId), isNull(w.archivedAt)),
    columns: { id: true, name: true },
    orderBy: (w, { asc }) => asc(w.createdAt),
  });
  return rows;
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
