"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";

type Role = "OWNER" | "HR_ADMIN" | "HR_STAFF";
const ROLE_LABELS: Record<Role, string> = { OWNER: "Owner", HR_ADMIN: "HR Administrator", HR_STAFF: "HR Staff" };

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  extraPermissions: string[];
  twoFactorEnabled: boolean;
  createdAt: string;
}

export function UsersManager({ users, currentUserId, grantable, rolePermissions }: { users: UserRow[]; currentUserId: string; grantable: string[]; rolePermissions: Record<Role, string[]> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <UserPlus className="size-4" aria-hidden /> New user
          </Button>
        )}
      </div>
      {creating && (
        <UserEditor
          grantable={grantable}
          rolePermissions={rolePermissions}
          onCancel={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      )}
      <Card className="overflow-hidden">
        <CardHeader title="Accounts" description={`${users.length} user${users.length === 1 ? "" : "s"}`} />
        <ul className="divide-y divide-border">
          {users.map((u) => (
            <li key={u.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">
                    {u.name} {u.id === currentUserId && <span className="text-xs text-ink-subtle">(you)</span>}
                  </p>
                  <p className="text-sm text-ink-muted">{u.email}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone="info" dot={false}>
                      {ROLE_LABELS[u.role]}
                    </Badge>
                    {u.isActive ? <Badge tone="success">Enabled</Badge> : <Badge tone="danger">Disabled</Badge>}
                    {u.twoFactorEnabled ? <Badge tone="teal">MFA on</Badge> : <Badge tone="warning">MFA off</Badge>}
                    {u.extraPermissions.map((p) => (
                      <Badge key={p} tone="neutral" dot={false}>
                        +{p}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditing(editing === u.id ? null : u.id)}>
                  {editing === u.id ? "Close" : "Manage"}
                </Button>
              </div>
              {editing === u.id && (
                <div className="mt-4">
                  <UserEditor
                    user={u}
                    self={u.id === currentUserId}
                    grantable={grantable}
                    rolePermissions={rolePermissions}
                    onCancel={() => setEditing(null)}
                    onSaved={() => {
                      setEditing(null);
                      router.refresh();
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function UserEditor({
  user,
  self,
  grantable,
  rolePermissions,
  onCancel,
  onSaved,
}: {
  user?: UserRow;
  self?: boolean;
  grantable: string[];
  rolePermissions: Record<Role, string[]>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "HR_STAFF");
  const [isActive, setActive] = useState(user?.isActive ?? true);
  const [extra, setExtra] = useState<string[]>(user?.extraPermissions ?? []);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inherited = new Set(rolePermissions[role]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const extraPermissions = extra.filter((p) => !inherited.has(p));
      if (user) {
        await api(`/api/users/${user.id}`, {
          method: "PATCH",
          body: { name, role, isActive, extraPermissions, ...(password ? { password } : {}) },
        });
        toast.success("User updated — their sessions were signed out");
      } else {
        await api("/api/users", { body: { name, email, role, password, extraPermissions } });
        toast.success("User created. Share the temporary password securely.");
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
        toast.error(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const pre = user ? `u-${user.id}` : "new";
  return (
    <Card className="border-primary-500/30 bg-primary-50/30">
      <form onSubmit={save} className="space-y-4 p-5">
        {!user && <h3 className="font-semibold text-ink">New user</h3>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor={`${pre}-name`} error={errors.name} required>
            <Input id={`${pre}-name`} value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email" htmlFor={`${pre}-email`} error={errors.email} required>
            <Input id={`${pre}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={Boolean(user)} />
          </Field>
          <Field label="Role" htmlFor={`${pre}-role`} error={errors.role}>
            <Select id={`${pre}-role`} value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={self}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={user ? "Reset password" : "Temporary password"}
            htmlFor={`${pre}-password`}
            error={errors.password}
            hint={user ? "Leave blank to keep the current password." : "At least 12 characters. Ask the user to change it after first sign-in."}
            required={!user}
          >
            <Input id={`${pre}-password`} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required={!user} minLength={12} />
          </Field>
        </div>
        {role !== "OWNER" && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">Additional permissions</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {grantable.map((p) => (
                <Checkbox
                  key={p}
                  label={p}
                  description={inherited.has(p) ? "Included in role" : undefined}
                  checked={inherited.has(p) || extra.includes(p)}
                  disabled={inherited.has(p)}
                  onChange={(e) => setExtra((x) => (e.target.checked ? [...x, p] : x.filter((y) => y !== p)))}
                />
              ))}
            </div>
          </fieldset>
        )}
        {user && !self && <Checkbox label="Account enabled" description="Disabled users cannot sign in." checked={isActive} onChange={(e) => setActive(e.target.checked)} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {user ? "Save changes" : "Create user"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
