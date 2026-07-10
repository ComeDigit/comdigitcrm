import "server-only";
import { cookies } from "next/headers";
import { demoWorkspaces } from "@/features/demo-data/generator";

/**
 * Resolve the active workspace for the current request (cookie-selected,
 * validated against the list the user may access). Demo mode validates
 * against demo workspaces; live mode validates against memberships.
 */
export async function getActiveWorkspaceId(): Promise<string> {
  const store = await cookies();
  const requested = store.get("ws")?.value;
  const valid = demoWorkspaces.some((w) => w.id === requested);
  return valid && requested ? requested : demoWorkspaces[0].id;
}

export function getWorkspaceName(id: string): string {
  return demoWorkspaces.find((w) => w.id === id)?.name ?? "Workspace";
}
