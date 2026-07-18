import { AiInsights } from "@/features/ai/insights";
import { requireClientSession } from "@/lib/auth/client-session";

export const metadata = { title: "AI Copilot" };

export default async function ClientAiPage() {
  const session = await requireClientSession();

  return (
    <main className="space-y-6 px-6 py-6">
      <AiInsights workspaceId={session.workspaceId} />
    </main>
  );
}
