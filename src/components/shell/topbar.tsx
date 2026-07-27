import { ThemeToggle } from "@/components/shell/theme";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { getActiveWorkspaceId, listActiveWorkspaces } from "@/lib/workspace";

export async function Topbar({ title }: { title: string }) {
  const [activeId, workspaces] = await Promise.all([
    getActiveWorkspaceId(),
    listActiveWorkspaces(),
  ]);

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/80 px-6 backdrop-blur print:hidden">
      <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
      <div className="flex items-center gap-2">
        <WorkspaceSwitcher workspaces={workspaces} activeId={activeId} />
        <ThemeToggle />
      </div>
    </header>
  );
}
