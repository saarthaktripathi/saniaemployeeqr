"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { PRIORITY_LABELS, TASK_PRIORITIES, type TaskPriority } from "@/features/tasks/schema";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card } from "@/components/ui/primitives";

interface Person {
  id: string;
  displayName: string;
  employeeCode: string;
  jobTitle: string;
  department?: string;
}

/** Multi-select employee search (HR): type-ahead against the directory options endpoint. */
function PeoplePicker({ value, onChange }: { value: Person[]; onChange: (p: Person[]) => void }) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || q.trim().length < 1) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await api<{ options: Person[] }>(`/api/employees/options?${new URLSearchParams({ q: q.trim() })}`);
        setOptions(res.options);
      } catch {
        setOptions([]);
      }
    }, 200);
  }, [q, open]);

  const chosen = new Set(value.map((v) => v.id));
  const visible = open && q.trim() ? options : [];
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
        <Input
          role="combobox"
          aria-expanded={visible.length > 0}
          aria-controls={listId}
          aria-label="Search employees to assign"
          placeholder="Search by name or employee ID"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="pl-9"
        />
        {visible.length > 0 && (
          <ul id={listId} role="listbox" aria-label="Employees" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-white p-1 shadow-[var(--shadow-lift)]">
            {visible.map((o) => (
              <li
                key={o.id}
                role="option"
                aria-selected={chosen.has(o.id)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!chosen.has(o.id)) onChange([...value, o]);
                  setQ("");
                }}
                className="cursor-pointer rounded-lg px-3 py-2 text-sm hover:bg-navy-100 aria-selected:opacity-50"
              >
                <span className="font-medium text-ink">{o.displayName}</span> <span className="text-xs text-ink-subtle">{o.employeeCode} · {o.jobTitle}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Selected employees" data-testid="selected-assignees">
          {value.map((p) => (
            <li key={p.id} className="flex items-center gap-1 rounded-full bg-primary-50 py-1 pr-1 pl-3 text-sm text-primary-700">
              {p.displayName}
              <button type="button" onClick={() => onChange(value.filter((v) => v.id !== p.id))} aria-label={`Remove ${p.displayName}`} className="grid size-5 place-items-center rounded-full hover:bg-primary-100">
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * New task. HR (`mode="hr"`): one person, several people or a whole department. Team managers
 * (`mode="team"`): pick from their reporting team. The server re-checks who may be assigned.
 */
export function TaskForm({ mode, departments = [], team = [], doneHref }: { mode: "hr" | "team"; departments?: string[]; team?: Person[]; doneHref: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [target, setTarget] = useState<"PEOPLE" | "DEPARTMENT">("PEOPLE");
  const [people, setPeople] = useState<Person[]>([]);
  const [department, setDepartment] = useState(departments[0] ?? "");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const body =
      target === "DEPARTMENT"
        ? { title, description, priority, target: "DEPARTMENT", department, startDate, dueDate }
        : { title, description, priority, target: people.length === 1 ? "INDIVIDUAL" : "MULTIPLE", employeeIds: people.map((p) => p.id), startDate, dueDate };
    try {
      const res = await api<{ task: { id: string; code: string; assignees: number } }>("/api/tasks", { body });
      toast.success(`${res.task.code} assigned to ${res.task.assignees} ${res.task.assignees === 1 ? "person" : "people"}`);
      router.push(`${doneHref}/${res.task.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
        toast.error(err.fields[0]?.message ?? err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-5 p-5" data-testid="task-form">
        <Field label="Title" htmlFor="task-title" error={errors.title} required>
          <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
        </Field>
        <Field label="Instructions" htmlFor="task-desc" error={errors.description} hint="What needs to be done, and what “done” looks like.">
          <Textarea id="task-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} className="min-h-32" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Priority" htmlFor="task-priority">
            <Select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date" htmlFor="task-start" error={errors.startDate}>
            <Input id="task-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Due date" htmlFor="task-due" error={errors.dueDate}>
            <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        {mode === "hr" && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">Assign to</legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="target" checked={target === "PEOPLE"} onChange={() => setTarget("PEOPLE")} className="accent-primary-600" /> Specific people
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="target" checked={target === "DEPARTMENT"} onChange={() => setTarget("DEPARTMENT")} className="accent-primary-600" /> A whole department
              </label>
            </div>
          </fieldset>
        )}

        {mode === "hr" && target === "DEPARTMENT" ? (
          <Field label="Department" htmlFor="task-dept" error={errors.department} hint="Every active employee in the department gets their own copy of the task.">
            <Select id="task-dept" value={department} onChange={(e) => setDepartment(e.target.value)}>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        ) : mode === "hr" ? (
          <Field label="Employees" htmlFor="task-people" error={errors.employeeIds}>
            <PeoplePicker value={people} onChange={setPeople} />
          </Field>
        ) : (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">Team members</legend>
            {errors.employeeIds && <p className="mb-2 text-xs font-medium text-danger-700">{errors.employeeIds}</p>}
            {team.length === 0 ? (
              <p className="text-sm text-ink-muted">Nobody reports to you yet. Ask HR to set reporting managers.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {team.map((p) => (
                  <Checkbox
                    key={p.id}
                    label={p.displayName}
                    description={`${p.employeeCode} · ${p.jobTitle}`}
                    checked={people.some((x) => x.id === p.id)}
                    onChange={(e) => setPeople((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x.id !== p.id)))}
                  />
                ))}
              </div>
            )}
          </fieldset>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={title.trim().length < 3 || (target === "PEOPLE" && people.length === 0)}>
            Assign task
          </Button>
        </div>
        <p className="text-xs text-ink-subtle">You can attach files after the task is created.</p>
      </form>
    </Card>
  );
}
