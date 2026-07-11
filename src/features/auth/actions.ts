"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServer } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { getDb } from "@/lib/db";
import { organizations, workspaces, memberships, profiles } from "@/db/schema";

/**
 * Auth + onboarding server actions. Onboarding runs once after first
 * sign-in: creates the agency org, the first client workspace, and an
 * agency_owner membership. Uses the service-role Drizzle client because
 * the user has no org claim yet (chicken-and-egg) — inputs are validated
 * and the authenticated user id comes from the session, never the client.
 */

export interface ActionResult {
  error?: string;
  ok?: boolean;
}

const onboardingSchema = z.object({
  orgName: z.string().trim().min(2, "Agency name is too short").max(80),
  workspaceName: z.string().trim().min(2, "Client name is too short").max(80),
});

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "org"
  );
}

export async function completeOnboarding(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  if (isDemoMode) {
    return { error: "Demo mode — connect Supabase to create your agency." };
  }

  const parsed = onboardingSchema.safeParse({
    orgName: formData.get("orgName"),
    workspaceName: formData.get("workspaceName"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = (await supabase?.auth.getUser()) ?? { data: { user: null } };
  if (!user) return { error: "Not signed in." };

  const db = getDb();

  // Idempotent: if the user already belongs to an org, skip creation.
  const existing = await db.query.memberships.findFirst({
    where: (m, { eq }) => eq(m.userId, user.id),
  });
  if (existing) redirect("/dashboard");

  const suffix = user.id.slice(0, 6);
  await db.transaction(async (tx) => {
    await tx
      .insert(profiles)
      .values({ id: user.id, email: user.email ?? "", fullName: null })
      .onConflictDoNothing();

    const [org] = await tx
      .insert(organizations)
      .values({
        name: parsed.data.orgName,
        slug: `${slugify(parsed.data.orgName)}-${suffix}`,
      })
      .returning();

    await tx.insert(workspaces).values({
      orgId: org.id,
      name: parsed.data.workspaceName,
      slug: slugify(parsed.data.workspaceName),
    });

    await tx.insert(memberships).values({
      orgId: org.id,
      userId: user.id,
      role: "agency_owner",
      workspaceIds: null, // all workspaces
    });
  });

  // The org_id JWT claim is stamped by the auth hook on the next token
  // refresh; signing the user out of the stale session forces it now.
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServer();
  await supabase?.auth.signOut();
  redirect("/login");
}
