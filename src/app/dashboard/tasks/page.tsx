import { Topbar } from "@/components/shell/topbar";
import { Card, Badge } from "@/components/ui/primitives";
import { getPrincipal } from "@/lib/auth/principal";
import { getTasks, getWorkspaces, type TaskRow } from "@/features/crm/queries";
import { NewTaskForm, AdvanceTaskButton } from "@/features/crm/components/forms";
import { redirect } from "next/navigation";

export const metadata = { title: "Tasks" };

const COLUMNS: Array<{ key: TaskRow["status"]; label: string }> = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

export default async function TasksPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const [taskList, workspaces] = await Promise.all([
    getTasks(principal.orgId),
    getWorkspaces(principal.orgId),
  ]);
  const wsName = (id: string | null) =>
    workspaces.find((w) => w.id === id)?.name ?? "General";

  return (
    <>
      <Topbar title="Tasks" />
      <main className="px-6 py-6">
        <div className="mb-4 flex justify-end">
          <NewTaskForm workspaces={workspaces} />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const colTasks = taskList.filter((t) => t.status === col.key);
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
                      <div className="flex items-center justify-between gap-2">
                        <Badge tone="outline">{wsName(t.workspaceId)}</Badge>
                        <div className="flex items-center gap-1.5">
                          {t.dueDate ? (
                            <span className="text-[11px] text-muted">
                              due {t.dueDate.slice(5)}
                            </span>
                          ) : null}
                          <AdvanceTaskButton taskId={t.id} status={t.status} />
                        </div>
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
