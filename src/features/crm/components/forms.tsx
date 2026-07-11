"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  createContact,
  createTask,
  updateTaskStatus,
  type ActionResult,
} from "@/features/crm/actions";
import { Button } from "@/components/ui/primitives";

/** CRM client components: add-contact, add-task, move-task. */

const initial: ActionResult = {};

const inputCls =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Popover({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? <X size={13} /> : <Plus size={13} />} {label}
      </Button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-border bg-surface p-4 shadow-xl">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function NewContactForm({
  workspaces,
}: {
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(createContact, initial);
  return (
    <Popover label="Add contact">
      {() => (
        <form action={formAction} className="space-y-2.5">
          <select name="workspaceId" required className={inputCls} defaultValue="">
            <option value="" disabled>
              Client workspace…
            </option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <input name="fullName" required placeholder="Full name" className={inputCls} />
          <input name="title" placeholder="Title (optional)" className={inputCls} />
          <input name="email" type="email" placeholder="Email (optional)" className={inputCls} />
          <input name="phone" placeholder="Phone (optional)" className={inputCls} />
          {state.error ? <p className="text-xs text-negative">{state.error}</p> : null}
          {state.ok ? <p className="text-xs text-positive">Saved.</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Save contact"}
          </Button>
        </form>
      )}
    </Popover>
  );
}

export function NewTaskForm({
  workspaces,
}: {
  workspaces: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(createTask, initial);
  return (
    <Popover label="New task">
      {() => (
        <form action={formAction} className="space-y-2.5">
          <select name="workspaceId" required className={inputCls} defaultValue="">
            <option value="" disabled>
              Client workspace…
            </option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <input name="title" required placeholder="Task title" className={inputCls} />
          <input name="dueDate" type="date" className={inputCls} />
          {state.error ? <p className="text-xs text-negative">{state.error}</p> : null}
          {state.ok ? <p className="text-xs text-positive">Saved.</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Create task"}
          </Button>
        </form>
      )}
    </Popover>
  );
}

const NEXT_STATUS: Record<string, { value: string; label: string } | null> = {
  todo: { value: "in_progress", label: "Start →" },
  in_progress: { value: "review", label: "Review →" },
  review: { value: "done", label: "Done ✓" },
  done: null,
};

export function AdvanceTaskButton({
  taskId,
  status,
}: {
  taskId: string;
  status: string;
}) {
  const [state, formAction, pending] = useActionState(updateTaskStatus, initial);
  const next = NEXT_STATUS[status];
  if (!next) return null;
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="status" value={next.value} />
      <button
        type="submit"
        disabled={pending}
        title={state.error}
        className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
      >
        {pending ? "…" : next.label}
      </button>
    </form>
  );
}
