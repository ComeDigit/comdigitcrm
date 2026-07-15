"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import { contacts, tasks, auditLog, workspaces } from "@/db/schema";
import { authorize, AuthorizationError } from "@/lib/auth/authorize";
import { getPrincipal, actorIdOrNull } from "@/lib/auth/principal";
import { and, eq } from "drizzle-orm";

/**
 * CRM mutations. Every action follows the same contract:
 * 1. Zod-validate input   2. resolve principal   3. authorize()
 * 4. tenant-scoped write  5. audit log            6. revalidate
 * Demo mode returns a friendly error instead of writing (there is no
 * database to write to).
 */

export interface ActionResult {
  error?: string;
  ok?: boolean;
}

const DEMO_ERROR =
  "Demo mode is read-only — connect Supabase to save real data.";

const contactSchema = z.object({
  workspaceId: z.string().uuid("Pick a client workspace"),
  fullName: z.string().trim().min(2, "Name is too short").max(120),
  title: z.string().trim().max(80).optional().or(z.literal("")),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().trim().max(24).optional().or(z.literal("")),
});

export async function createContact(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (isDemoMode) return { error: DEMO_ERROR };

  const parsed = contactSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    fullName: formData.get("fullName"),
    title: formData.get("title"),
    email: formData.get("email"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const principal = await getPrincipal();
  if (!principal) return { error: "Not signed in." };

  try {
    authorize(principal, "crm.write", parsed.data.workspaceId);
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    throw e;
  }

  const db = getDb();
  const [row] = await db
    .insert(contacts)
    .values({
      orgId: principal.orgId,
      workspaceId: parsed.data.workspaceId,
      fullName: parsed.data.fullName,
      title: parsed.data.title || null,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
    })
    .returning({ id: contacts.id });

  await db.insert(auditLog).values({
    orgId: principal.orgId,
    workspaceId: parsed.data.workspaceId,
    actorId: actorIdOrNull(principal.userId),
    action: "contact.create",
    resourceType: "contact",
    resourceId: row.id,
    after: parsed.data,
  });

  revalidatePath("/dashboard/clients");
  return { ok: true };
}

const workspaceSchema = z.object({
  name: z.string().trim().min(2, "Client name is too short").max(80),
});

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "client"
  );
}

/** Adds a new client brand (workspace) to the agency's one organization. */
export async function createWorkspace(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (isDemoMode) return { error: DEMO_ERROR };

  const parsed = workspaceSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const principal = await getPrincipal();
  try {
    authorize(principal, "workspace.manage");
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    throw e;
  }

  const db = getDb();
  const baseSlug = slugify(parsed.data.name);
  let slug = baseSlug;
  for (let i = 2; i <= 20; i++) {
    const clash = await db.query.workspaces.findFirst({
      where: (w, { and, eq }) => and(eq(w.orgId, principal.orgId), eq(w.slug, slug)),
    });
    if (!clash) break;
    slug = `${baseSlug}-${i}`;
  }

  const [row] = await db
    .insert(workspaces)
    .values({ orgId: principal.orgId, name: parsed.data.name, slug })
    .returning({ id: workspaces.id });

  await db.insert(auditLog).values({
    orgId: principal.orgId,
    workspaceId: row.id,
    actorId: actorIdOrNull(principal.userId),
    action: "workspace.create",
    resourceType: "workspace",
    resourceId: row.id,
    after: parsed.data,
  });

  revalidatePath("/dashboard/clients");
  revalidatePath("/dashboard");
  return { ok: true };
}

const taskSchema = z.object({
  workspaceId: z.string().uuid("Pick a client workspace"),
  title: z.string().trim().min(2, "Title is too short").max(200),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a due date")
    .optional()
    .or(z.literal("")),
});

export async function createTask(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (isDemoMode) return { error: DEMO_ERROR };

  const parsed = taskSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    title: formData.get("title"),
    dueDate: formData.get("dueDate"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const principal = await getPrincipal();
  if (!principal) return { error: "Not signed in." };

  try {
    authorize(principal, "crm.write", parsed.data.workspaceId);
  } catch (e) {
    if (e instanceof AuthorizationError) return { error: "Not allowed." };
    throw e;
  }

  const db = getDb();
  const [row] = await db
    .insert(tasks)
    .values({
      orgId: principal.orgId,
      workspaceId: parsed.data.workspaceId,
      title: parsed.data.title,
      dueDate: parsed.data.dueDate || null,
      createdBy: actorIdOrNull(principal.userId),
    })
    .returning({ id: tasks.id });

  await db.insert(auditLog).values({
    orgId: principal.orgId,
    workspaceId: parsed.data.workspaceId,
    actorId: actorIdOrNull(principal.userId),
    action: "task.create",
    resourceType: "task",
    resourceId: row.id,
    after: parsed.data,
  });

  revalidatePath("/dashboard/tasks");
  return { ok: true };
}

const taskStatusSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(["todo", "in_progress", "review", "done"]),
});

export async function updateTaskStatus(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (isDemoMode) return { error: DEMO_ERROR };

  const parsed = taskStatusSchema.safeParse({
    taskId: formData.get("taskId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: "Invalid input" };

  const principal = await getPrincipal();
  if (!principal) return { error: "Not signed in." };

  const db = getDb();
  // Tenant-scoped read first: org filter is the IDOR guard — a foreign
  // task id resolves to nothing. Authorize BEFORE mutating.
  const existing = await db.query.tasks.findFirst({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.id, parsed.data.taskId), eqOp(t.orgId, principal.orgId)),
    columns: { id: true, workspaceId: true },
  });
  if (!existing) return { error: "Task not found." };

  try {
    authorize(principal, "crm.write", existing.workspaceId ?? undefined);
  } catch {
    return { error: "Not allowed." };
  }

  const [row] = await db
    .update(tasks)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(and(eq(tasks.id, parsed.data.taskId), eq(tasks.orgId, principal.orgId)))
    .returning({ id: tasks.id, workspaceId: tasks.workspaceId });
  if (!row) return { error: "Task not found." };

  await db.insert(auditLog).values({
    orgId: principal.orgId,
    workspaceId: row.workspaceId,
    actorId: actorIdOrNull(principal.userId),
    action: "task.status",
    resourceType: "task",
    resourceId: row.id,
    after: { status: parsed.data.status },
  });

  revalidatePath("/dashboard/tasks");
  return { ok: true };
}
