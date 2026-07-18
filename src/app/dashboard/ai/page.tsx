import { Topbar } from "@/components/shell/topbar";
import { AiInsights } from "@/features/ai/insights";
import { getActiveWorkspaceId, getWorkspaceName } from "@/lib/workspace";

export const metadata = { title: "AI Copilot" };

export default async function AiPage() {
  const workspaceId = await getActiveWorkspaceId();
  const workspaceName = await getWorkspaceName(workspaceId);

  return (
    <>
      <Topbar title={`AI Copilot — ${workspaceName}`} />
      <main className="space-y-6 px-6 py-6">
        <AiInsights workspaceId={workspaceId} />
      </main>
    </>
  );
}
