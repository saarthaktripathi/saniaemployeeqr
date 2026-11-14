"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Download, Paperclip, Send, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { cn, formatDateTime } from "@/lib/cn";
import { formatLongDate } from "@/lib/time";
import { PRIORITY_LABELS, PRIORITY_TONES, STATUS_LABELS, STATUS_TONES, TASK_PRIORITIES, type TaskPriority, type TaskStatus } from "@/features/tasks/schema";
import type { TaskDetail } from "@/server/services/tasks";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmOptions } from "@/components/ui/confirm-dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";

type Assignment = TaskDetail["assignments"][number];

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      router.refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? (err.fields[0]?.message ?? err.message) : "Something went wrong");
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

function FileList({ taskId, files, canDelete }: { taskId: string; files: { id: string; fileName: string; size: number; mine?: boolean }[]; canDelete: (f: { mine?: boolean }) => boolean }) {
  const { busy, run } = useAction();
  if (files.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {files.map((f) => (
        <li key={f.id} className="flex items-center justify-between gap-2 rounded-lg bg-navy-100/40 px-3 py-2 text-sm">
          <a href={`/api/tasks/${taskId}/files/${f.id}`} className="flex min-w-0 items-center gap-2 font-medium text-primary-700 hover:underline" download>
            <Paperclip className="size-4 shrink-0" aria-hidden /> <span className="truncate">{f.fileName}</span>
            <span className="shrink-0 text-xs text-ink-subtle">{Math.max(1, Math.round(f.size / 1024))} KB</span>
            <Download className="size-3.5 shrink-0" aria-hidden />
          </a>
          {canDelete(f) && (
            <button type="button" aria-label={`Remove ${f.fileName}`} disabled={busy === f.id} onClick={() => run(f.id, () => api(`/api/tasks/${taskId}/files/${f.id}`, { method: "DELETE" }), "File removed")} className="text-ink-subtle hover:text-danger-700">
              <Trash2 className="size-4" aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function UploadButton({ taskId, assignmentId, label }: { taskId: string; assignmentId?: string; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={label}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) return toast.error("Files can be at most 5 MB");
          await run(
            "upload",
            async () => {
              const res = await fetch(`/api/tasks/${taskId}/files${assignmentId ? `?assignment=${assignmentId}` : ""}`, {
                method: "POST",
                headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
                body: file,
              });
              if (!res.ok) throw new ApiError((await res.json().catch(() => null))?.error?.message ?? "Upload failed", res.status, "UPLOAD");
            },
            "File uploaded",
          );
        }}
      />
      <Button type="button" size="sm" variant="secondary" loading={busy === "upload"} onClick={() => input.current?.click()}>
        <Upload className="size-4" aria-hidden /> {label}
      </Button>
    </>
  );
}

function Thread({ a }: { a: Assignment }) {
  const [body, setBody] = useState("");
  const { busy, run } = useAction();
  return (
    <div className="space-y-3">
      <ul className="space-y-2" data-testid="task-comments">
        {a.comments.map((c) => (
          <li key={c.id} className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", c.mine ? "ml-auto bg-primary-50 text-ink" : "bg-navy-100/60 text-ink")}>
            <p className="text-xs font-semibold text-ink-muted">
              {c.author} · {formatDateTime(c.createdAt)}
            </p>
            <p className="mt-0.5 whitespace-pre-line">{c.body}</p>
          </li>
        ))}
        {a.comments.length === 0 && <li className="text-sm text-ink-subtle">No comments yet.</li>}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          if (await run("comment", () => api(`/api/tasks/assignments/${a.id}/comments`, { body: { body } }))) setBody("");
        }}
      >
        <label htmlFor={`comment-${a.id}`} className="sr-only">
          Add a comment
        </label>
        <Input id={`comment-${a.id}`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment…" maxLength={2000} />
        <Button type="submit" size="md" variant="secondary" loading={busy === "comment"} aria-label="Send comment">
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
}

/** Assignee controls: accept, start, progress, submit (with note), deliverables. */
function AssigneePanel({ task, a }: { task: TaskDetail; a: Assignment }) {
  const { busy, run } = useAction();
  const [progress, setProgress] = useState(a.progress);
  const [note, setNote] = useState("");
  const act = (action: string, extra: Record<string, unknown> = {}, ok?: string) => run(action, () => api(`/api/tasks/assignments/${a.id}`, { body: { action, ...extra } }), ok);
  const closed = a.status === "APPROVED" || a.status === "CANCELLED" || Boolean(task.cancelledAt);
  return (
    <Card data-testid="my-assignment">
      <CardHeader
        title="Your work"
        description={a.status === "REJECTED" && a.reviewNote ? `Changes requested: ${a.reviewNote}` : undefined}
        actions={<Badge tone={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</Badge>}
      />
      <div className="space-y-4 p-5">
        {!closed && (
          <>
            <div className="flex flex-wrap gap-2">
              {a.status === "ASSIGNED" && (
                <Button size="sm" variant="secondary" loading={busy === "ACCEPT"} onClick={() => act("ACCEPT", {}, "Task accepted")}>
                  Accept
                </Button>
              )}
              {["ASSIGNED", "ACCEPTED", "REJECTED"].includes(a.status) && (
                <Button size="sm" loading={busy === "START"} onClick={() => act("START", {}, "Started")}>
                  Start working
                </Button>
              )}
            </div>
            {a.status !== "SUBMITTED" && (
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label={`Progress: ${progress}%`} htmlFor={`progress-${a.id}`}>
                  <input id={`progress-${a.id}`} type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="w-full accent-primary-600" />
                </Field>
                <Button size="sm" variant="secondary" loading={busy === "PROGRESS"} disabled={progress === a.progress} onClick={() => act("PROGRESS", { progress }, "Progress saved")}>
                  Save progress
                </Button>
              </div>
            )}
            {["ACCEPTED", "IN_PROGRESS", "REJECTED"].includes(a.status) && (
              <div className="space-y-2 rounded-xl bg-success-50/60 p-3">
                <Field label="Note for the reviewer (optional)" htmlFor={`submit-note-${a.id}`}>
                  <Textarea id={`submit-note-${a.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-16" />
                </Field>
                <div className="flex justify-end">
                  <Button size="sm" loading={busy === "SUBMIT"} onClick={() => act("SUBMIT", note.trim() ? { note: note.trim() } : {}, "Submitted for review")} data-testid="submit-task">
                    Submit for review
                  </Button>
                </div>
              </div>
            )}
            {a.status === "SUBMITTED" && <p className="text-sm text-ink-muted">Submitted. Waiting for review.</p>}
          </>
        )}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Deliverables</p>
            {!closed && <UploadButton taskId={task.id} assignmentId={a.id} label="Upload file" />}
          </div>
          <FileList taskId={task.id} files={a.files} canDelete={(f) => Boolean(f.mine) && !closed} />
          {a.files.length === 0 && <p className="text-sm text-ink-subtle">No files uploaded.</p>}
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">Discussion</p>
          <Thread a={a} />
        </div>
      </div>
    </Card>
  );
}

/** Reviewer view of one assignee: status, progress, review actions, deliverables, thread. */
function ReviewRow({ task, a }: { task: TaskDetail; a: Assignment }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(a.status === "SUBMITTED");
  const [note, setNote] = useState("");
  return (
    <li className="px-5 py-3" data-testid="assignment-row" data-status={a.status}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 items-center gap-3 text-left" aria-expanded={open}>
          <EmployeeAvatar id={a.employeeId} name={a.name} photoUpdatedAt={a.photoUpdatedAt} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{a.name}</span>
            <span className="block text-xs text-ink-subtle">
              {a.employeeCode} · {a.department}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          <span className="w-24">
            <span className="block h-1.5 overflow-hidden rounded-full bg-navy-100">
              <span className="block h-full rounded-full bg-gradient-to-r from-primary-500 to-violet-600" style={{ width: `${a.progress}%` }} />
            </span>
            <span className="text-xs text-ink-subtle tabular-nums">{a.progress}%</span>
          </span>
          {a.overdue && <Badge tone="danger">Overdue</Badge>}
          <Badge tone={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</Badge>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-3 rounded-xl bg-page p-3">
          {a.status === "SUBMITTED" && task.canManage && (
            <div className="space-y-2" data-testid="review-panel">
              <Field label="Review note (required to request changes)" htmlFor={`review-${a.id}`}>
                <Textarea id={`review-${a.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="min-h-16" />
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="danger" loading={busy === "REJECT"} disabled={!note.trim()} onClick={() => run("REJECT", () => api(`/api/tasks/assignments/${a.id}/review`, { body: { decision: "REJECT", note } }), "Sent back for changes")}>
                  Request changes
                </Button>
                <Button size="sm" variant="success" loading={busy === "APPROVE"} onClick={() => run("APPROVE", () => api(`/api/tasks/assignments/${a.id}/review`, { body: { decision: "APPROVE", ...(note.trim() ? { note } : {}) } }), "Approved")}>
                  Approve
                </Button>
              </div>
            </div>
          )}
          {a.reviewNote && a.status !== "SUBMITTED" && (
            <p className="text-sm text-ink-muted">
              Last review{a.reviewedBy ? ` by ${a.reviewedBy}` : ""}: {a.reviewNote}
            </p>
          )}
          <FileList taskId={task.id} files={a.files} canDelete={() => false} />
          <Thread a={a} />
        </div>
      )}
    </li>
  );
}

function EditTask({ task }: { task: TaskDetail }) {
  const { busy, run } = useAction();
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Priority" htmlFor="edit-priority">
        <Select id="edit-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="sm:w-36">
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Due date" htmlFor="edit-due">
        <Input id="edit-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="sm:w-44" />
      </Field>
      <Button size="md" variant="secondary" loading={busy === "save"} disabled={priority === task.priority && dueDate === (task.dueDate ?? "")} onClick={() => run("save", () => api(`/api/tasks/${task.id}`, { method: "PATCH", body: { priority, dueDate: dueDate || null, version: task.version } }), "Task updated")}>
        Save
      </Button>
      <Button size="md" variant="danger" onClick={() => setPending({ title: "Cancel this task?", description: "Open work for every assignee is cancelled and they are notified.", confirmLabel: "Cancel task", tone: "danger", reasonLabel: "Reason", reasonRequired: true })}>
        Cancel task
      </Button>
      <ConfirmDialog
        open={pending !== null}
        options={pending ?? { title: "" }}
        busy={busy === "cancel"}
        onCancel={() => setPending(null)}
        onConfirm={async (reason) => {
          if (await run("cancel", () => api(`/api/tasks/${task.id}/cancel`, { body: { reason } }), "Task cancelled")) setPending(null);
        }}
      />
    </div>
  );
}

/** Task page body for assignees, team managers and HR. */
export function TaskDetailView({ task }: { task: TaskDetail }) {
  const mine = task.assignments.find((a) => a.id === task.myAssignmentId);
  const others = task.assignments.filter((a) => a.id !== task.myAssignmentId);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <Card>
          <div className="space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info" dot={false}>
                {task.code}
              </Badge>
              <Badge tone={PRIORITY_TONES[task.priority]} dot={false}>
                {PRIORITY_LABELS[task.priority]} priority
              </Badge>
              {task.cancelledAt && <Badge tone="danger">Cancelled</Badge>}
            </div>
            <p className="text-sm text-ink-muted">
              Assigned by <span className="font-medium text-ink">{task.createdBy}</span> on {formatDateTime(task.createdAt)}
              {task.startDate && ` · starts ${formatLongDate(task.startDate)}`}
              {task.dueDate && (
                <>
                  {" "}
                  · <span className={cn(task.dueDate < task.today && !task.cancelledAt ? "font-semibold text-danger-700" : "font-medium text-ink")}>due {formatLongDate(task.dueDate)}</span>
                </>
              )}
            </p>
            {task.cancelledAt && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">Cancelled: {task.cancelReason}</p>}
            <div className="text-sm whitespace-pre-line text-ink" data-testid="task-description">
              {task.description || <span className="text-ink-subtle">No description.</span>}
            </div>
            {(task.briefFiles.length > 0 || task.canManage) && (
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">Attachments</p>
                  {task.canManage && !task.cancelledAt && <UploadButton taskId={task.id} label="Attach file" />}
                </div>
                <FileList taskId={task.id} files={task.briefFiles} canDelete={() => task.canManage} />
              </div>
            )}
            {task.canManage && !task.cancelledAt && (
              <div className="border-t border-border pt-3">
                <EditTask task={task} />
              </div>
            )}
          </div>
        </Card>
        {mine && <AssigneePanel task={task} a={mine} />}
        {others.length > 0 && (
          <Card>
            <CardHeader title={mine ? "Other assignees" : "Assignees"} description={`${others.length} ${others.length === 1 ? "person" : "people"}`} />
            <ul className="divide-y divide-border" data-testid="assignee-list">
              {others.map((a) => (
                <ReviewRow key={a.id} task={task} a={a} />
              ))}
            </ul>
          </Card>
        )}
      </div>
      <Card className="h-fit min-w-0">
        <CardHeader title="History" />
        <ol className="max-h-[32rem] space-y-3 overflow-y-auto p-5" data-testid="task-history">
          {task.history.map((h) => (
            <li key={h.id} className="text-sm">
              <p className="text-ink">
                <span className="font-medium">{h.actor}</span> {h.action.replace(/_/g, " ")}
                {h.toStatus && h.fromStatus !== h.toStatus && <span className="text-ink-muted"> → {STATUS_LABELS[h.toStatus as TaskStatus]}</span>}
                {h.progress !== null && h.action === "progress" && <span className="text-ink-muted"> ({h.progress}%)</span>}
              </p>
              {h.note && <p className="text-xs text-ink-muted">{h.note}</p>}
              <p className="text-xs text-ink-subtle">{formatDateTime(h.createdAt)}</p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
