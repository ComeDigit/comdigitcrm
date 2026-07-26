"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Plus, X, Pencil, Pause, Play, RotateCcw } from "lucide-react";
import {
  createContact,
  createTask,
  createWorkspace,
  updateTaskStatus,
  updateWorkspace,
  setWorkspaceStatus,
  archiveWorkspace,
  restoreWorkspace,
  type ActionResult,
} from "@/features/crm/actions";
import { Button } from "@/components/ui/primitives";

/** CRM client components: add-contact, add-task, move-task. */

const initial: ActionResult = {};

const inputCls =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Popover({
  label,
  icon,
  align = "right",
  children,
}: {
  label: string;
  icon?: ReactNode;
  align?: "left" | "right";
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        {open ? <X size={13} /> : (icon ?? <Plus size={13} />)} {label}
      </Button>
      {open ? (
        <div
          className={`absolute z-30 mt-2 w-80 rounded-xl border border-border bg-surface p-4 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function NewWorkspaceForm() {
  const [state, formAction, pending] = useActionState(createWorkspace, initial);
  return (
    <Popover label="Add client">
      {() => (
        <form action={formAction} className="space-y-2.5">
          <input name="name" required placeholder="Client / brand name" className={inputCls} />
          {state.error ? <p className="text-xs text-negative">{state.error}</p> : null}
          {state.ok ? <p className="text-xs text-positive">Client added.</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Adding…" : "Add client"}
          </Button>
        </form>
      )}
    </Popover>
  );
}

/** Rename a client / set its website — the popover behind each card's "Edit". */
export function EditWorkspaceForm({
  workspace,
}: {
  workspace: { id: string; name: string; website: string | null };
}) {
  const [state, formAction, pending] = useActionState(updateWorkspace, initial);
  return (
    <Popover label="Edit" icon={<Pencil size={13} />} align="left">
      {() => (
        <form action={formAction} className="space-y-2.5">
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <input
            name="name"
            required
            defaultValue={workspace.name}
            placeholder="Client / brand name"
            className={inputCls}
          />
          <input
            name="website"
            defaultValue={workspace.website ?? ""}
            placeholder="Website (optional)"
            className={inputCls}
          />
          {state.error ? <p className="text-xs text-negative">{state.error}</p> : null}
          {state.ok ? <p className="text-xs text-positive">Saved.</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      )}
    </Popover>
  );
}

/** Suspend blocks that client's own portal login only — admin access, data, and every record are untouched. Reversible with one click. */
export function WorkspaceStatusToggle({
  workspaceId,
  status,
}: {
  workspaceId: string;
  status: "active" | "suspended";
}) {
  const [state, formAction, pending] = useActionState(setWorkspaceStatus, initial);
  const next = status === "active" ? "suspended" : "active";
  return (
    <form action={formAction} className="inline" title={state.error}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="status" value={next} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? (
          "…"
        ) : status === "active" ? (
          <>
            <Pause size={13} /> Suspend
          </>
        ) : (
          <>
            <Play size={13} /> Reactivate
          </>
        )}
      </Button>
    </form>
  );
}

/** "Delete client" — archives (soft-delete), never hard-deletes. A confirm
 * step inside the popover explains that, so nobody assumes it's permanent. */
export function ArchiveWorkspaceForm({
  workspaceId,
  name,
}: {
  workspaceId: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(archiveWorkspace, initial);
  return (
    <Popover label="Delete" icon={<X size={13} />}>
      {() => (
        <form action={formAction} className="space-y-2.5">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <p className="text-[13px]">
            Archive <span className="font-medium">{name}</span>? This removes it from your
            active roster and blocks its client login, but keeps every contact, task, and
            connection on file — restore it any time from Archived clients below.
          </p>
          {state.error ? <p className="text-xs text-negative">{state.error}</p> : null}
          <Button type="submit" variant="outline" className="w-full" disabled={pending}>
            {pending ? "Archiving…" : "Archive client"}
          </Button>
        </form>
      )}
    </Popover>
  );
}

/** Undoes ArchiveWorkspaceForm — brings a client back onto the active roster. */
export function RestoreWorkspaceForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction, pending] = useActionState(restoreWorkspace, initial);
  return (
    <form action={formAction} className="inline" title={state.error}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Button type="submit" variant="outline" disabled={pending}>
        <RotateCcw size={13} /> {pending ? "Restoring…" : "Restore"}
      </Button>
    </form>
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
