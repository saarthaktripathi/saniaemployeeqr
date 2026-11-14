"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardHeader } from "@/components/ui/primitives";

/** HR announcement: in-app notification to everyone, one company or one department. */
export function AnnouncementForm({ companies, departments }: { companies: { id: string; name: string }[]; departments: string[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"all" | "company" | "department">("all");
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [department, setDepartment] = useState(departments[0] ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const audience = kind === "all" ? { kind } : kind === "company" ? { kind, companyId } : { kind, department };
      const res = await api<{ announcement: { recipients: number } }>("/api/announcements", { body: { title, body, audience } });
      toast.success(`Sent to ${res.announcement.recipients} ${res.announcement.recipients === 1 ? "person" : "people"}`);
      setTitle("");
      setBody("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? (err.fields[0]?.message ?? err.message) : "Could not send the announcement");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="New announcement" description="Delivered instantly as an in-app notification. Use it for holidays, policy changes and office news." />
      <form onSubmit={submit} className="space-y-4 p-5" data-testid="announcement-form">
        <Field label="Title" htmlFor="ann-title" required>
          <Input id="ann-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </Field>
        <Field label="Message" htmlFor="ann-body" required>
          <Textarea id="ann-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} required className="min-h-28" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Send to" htmlFor="ann-kind">
            <Select id="ann-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="all">Everyone with a login</option>
              {companies.length > 0 && <option value="company">One company</option>}
              {departments.length > 0 && <option value="department">One department</option>}
            </Select>
          </Field>
          {kind === "company" && (
            <Field label="Company" htmlFor="ann-company">
              <Select id="ann-company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {kind === "department" && (
            <Field label="Department" htmlFor="ann-dept">
              <Select id="ann-dept" value={department} onChange={(e) => setDepartment(e.target.value)}>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={title.trim().length < 3 || body.trim().length < 3}>
            <Megaphone className="size-4" aria-hidden /> Send announcement
          </Button>
        </div>
      </form>
    </Card>
  );
}
