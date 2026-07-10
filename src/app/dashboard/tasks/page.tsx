import { Topbar } from "@/components/shell/topbar";
import { Card, Badge } from "@/components/ui/primitives";
import { demoTasks, demoWorkspaces, type DemoTask } from "@/features/demo-data/generator";

export const metadata = { title: "Tasks" };

const COLUMNS: Array<{ key: DemoTask["status"]; label: string }> = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

function workspaceName(id: string): string {
  return demoWorkspaces.find((w) => w.id === id)?.name ?? "";
}

export default function TasksPage() {
  const tasks = demoTasks();

  return (
    <>
      <Topbar title="Tasks" />
      <main className="px-6 py-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.key);
            return (
              <div key={col.key} className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted">
                    {col.label}
                  </p>
                  <span className="text-xs text-muted tabular-nums">
                    {colTasks.length}
                  </span>
                </div>
                {colTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted">
                    Empty
                  </div>
                ) : (
                  colTasks.map((t) => (
                    <Card key={t.id} className="space-y-2 px-4 py-3">
                      <p className="text-[13px] font-medium leading-snug">
                        {t.title}
                      </p>
                      <div className="flex items-center justify-between">
                        <Badge tone="outline">{workspaceName(t.workspaceId)}</Badge>
                        <span className="text-[11px] text-muted">
                          {t.assignee} · due {t.dueDate.slice(5)}
                        </span>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
