"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardHeader } from "@/components/ui/primitives";
import { employeeCreateFormSchema, employeeEditFormSchema } from "@/features/employees/schema";
import { EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES, EXIT_TYPE_LABELS, EXIT_TYPES, WORK_MODE_LABELS, WORK_MODES } from "@/features/employees/labels";
import { deleteEmployeePhoto, PhotoUpload, uploadEmployeePhoto, type PhotoChange } from "./photo-upload";
import { ManagerPicker, type PersonOption } from "./manager-picker";

export interface EmployeeFormValues {
  firstName: string;
  lastName: string;
  displayName: string;
  workEmail: string;
  phone: string;
  companyId: string;
  department: string;
  jobTitle: string;
  businessVertical: string;
  employmentType: string;
  workMode: string;
  workLocation: string;
  team: string;
  reportingManagerId: string;
  attendanceRef: string;
  leavePolicy: string;
  leaveSystemUrl: string;
  joiningDate: string;
  idIssueDate: string;
  idExpiresAt: string;
  /** Create only: initial employment status. */
  employmentStatus: "ACTIVE" | "INACTIVE";
  /** Edit only, after an exit has been recorded. */
  exitDate: string;
  exitType: string;
  exitReason: string;
}

const empty: EmployeeFormValues = {
  firstName: "",
  lastName: "",
  displayName: "",
  workEmail: "",
  phone: "",
  companyId: "",
  department: "",
  jobTitle: "",
  businessVertical: "",
  employmentType: "",
  workMode: "",
  workLocation: "",
  team: "",
  reportingManagerId: "",
  attendanceRef: "",
  leavePolicy: "",
  leaveSystemUrl: "",
  joiningDate: "",
  idIssueDate: "",
  idExpiresAt: "",
  employmentStatus: "ACTIVE",
  exitDate: "",
  exitType: "",
  exitReason: "",
};

export interface EmployeeFormOptions {
  companies: { id: string; name: string; isActive: boolean }[];
  departments: string[];
  designations: string[];
  teams: string[];
  verticals: string[];
  locations: string[];
}

type Mode = { kind: "create" } | { kind: "edit"; id: string; version: number; exited: boolean };

function Suggestions({ id, values }: { id: string; values: string[] }) {
  return (
    <datalist id={id}>
      {values.map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  );
}

export function EmployeeForm({
  mode,
  initial,
  options,
  defaultValidityDays,
  photoUrl = null,
  initialManager = null,
}: {
  mode: Mode;
  initial?: Partial<EmployeeFormValues>;
  options: EmployeeFormOptions;
  defaultValidityDays: number;
  /** Current photo (edit mode). */
  photoUrl?: string | null;
  initialManager?: PersonOption | null;
}) {
  const router = useRouter();
  const photo = useRef<PhotoChange>({ kind: "keep" });
  const onPhotoChange = useCallback((c: PhotoChange) => {
    photo.current = c;
  }, []);
  const [progress, setProgress] = useState<number | null>(null);
  const [manager, setManager] = useState<PersonOption | null>(initialManager);
  const schema = mode.kind === "create" ? employeeCreateFormSchema : employeeEditFormSchema;
  const activeCompanies = options.companies.filter((c) => c.isActive);
  const defaults: EmployeeFormValues = {
    ...empty,
    ...(mode.kind === "create"
      ? { employmentType: "FULL_TIME", workMode: "OFFICE", companyId: activeCompanies.length === 1 ? activeCompanies[0].id : "" }
      : {}),
    ...initial,
  };
  const {
    register,
    handleSubmit,
    getValues,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFormValues>({
    defaultValues: defaults,
    // Client-side validation mirrors the server schema; the server remains authoritative.
    resolver: zodResolver(schema as unknown as z.ZodType<EmployeeFormValues, EmployeeFormValues>),
    mode: "onBlur",
  });

  const submit = async () => {
    // Send the raw string values: handleSubmit receives the schema's transformed output
    // (e.g. Date objects), which the server's YYYY-MM-DD validation would reject.
    const { employmentStatus, exitDate, exitType, exitReason, ...values } = getValues();
    try {
      let id: string;
      if (mode.kind === "create") {
        const { employee } = await api<{ employee: { id: string; employeeCode: string } }>("/api/employees", { body: { ...values, employmentStatus } });
        id = employee.id;
        toast.success(`Employee created — ${employee.employeeCode}`);
      } else {
        id = mode.id;
        const exit = mode.exited ? { exitDate, exitType, exitReason } : {};
        await api(`/api/employees/${id}`, { method: "PATCH", body: { ...values, ...exit, version: mode.version } });
        toast.success("Changes saved");
      }
      // The record is saved first; a photo failure never loses the employee data.
      await savePhoto(id);
      router.push(`/employees/${id}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError) {
        for (const f of e.fields) {
          if (f.path in empty) setError(f.path as keyof EmployeeFormValues, { message: f.message });
        }
        const field = e.details?.field;
        if (typeof field === "string" && field in empty) setError(field as keyof EmployeeFormValues, { message: e.message });
        toast.error(e.message);
      } else toast.error("Could not save. Check your connection and try again.");
    }
  };
  // handleSubmit is invoked inside the event handler (it reads refs, which must not happen during render).
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => handleSubmit(submit)(e);

  const nameParts = useWatch({ control, name: ["firstName", "lastName"] });

  async function savePhoto(id: string) {
    const change = photo.current;
    try {
      if (change.kind === "set") {
        setProgress(0);
        await uploadEmployeePhoto(id, await change.render(), setProgress);
        toast.success("Photo saved");
      } else if (change.kind === "remove") {
        await deleteEmployeePhoto(id);
        toast.success("Photo removed");
      }
    } catch (e) {
      toast.error(`${e instanceof Error ? e.message : "Photo upload failed"}. The employee was saved — try the photo again from Edit.`);
    } finally {
      setProgress(null);
    }
  }

  const f = (name: keyof EmployeeFormValues) => ({
    id: name,
    ...register(name),
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });

  // An inactive company stays selectable for records that already belong to it.
  const companyChoices = options.companies.filter((c) => c.isActive || c.id === defaults.companyId);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Card>
        <CardHeader eyebrow="Profile" title="Photo & personal details" description="The photo and name appear on the digital employee ID card and the verification page." />
        <div className="grid gap-6 p-5 md:grid-cols-[260px_1fr]">
          <PhotoUpload name={nameParts.filter(Boolean).join(" ")} existingUrl={photoUrl} onChange={onPhotoChange} disabled={isSubmitting} progress={progress} />
          <div className="grid content-start gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="firstName" required error={errors.firstName?.message}>
              <Input {...f("firstName")} autoComplete="off" />
            </Field>
            <Field label="Last name" htmlFor="lastName" error={errors.lastName?.message} hint="Leave blank for single-name employees.">
              <Input {...f("lastName")} autoComplete="off" />
            </Field>
            <Field label="Display name" htmlFor="displayName" error={errors.displayName?.message} hint="Optional. Defaults to first + last name." className="sm:col-span-2">
              <Input {...f("displayName")} autoComplete="off" />
            </Field>
            <Field label="Official email ID" htmlFor="workEmail" error={errors.workEmail?.message} hint="Optional. Private — never shown publicly.">
              <Input type="email" {...f("workEmail")} autoComplete="off" />
            </Field>
            <Field label="Contact number" htmlFor="phone" error={errors.phone?.message} hint="Optional. Private — never shown publicly.">
              <Input type="tel" {...f("phone")} autoComplete="off" />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Organisation" title="Company, role & reporting" description="Company, designation and department may appear on the ID card and public verification page, per System Rules." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Company" htmlFor="companyId" required error={errors.companyId?.message}>
            <Select {...f("companyId")}>
              <option value="">Choose a company…</option>
              {companyChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Business vertical" htmlFor="businessVertical" error={errors.businessVertical?.message}>
            <Input {...f("businessVertical")} list="vertical-options" autoComplete="off" />
            <Suggestions id="vertical-options" values={options.verticals} />
          </Field>
          <Field label="Department" htmlFor="department" required error={errors.department?.message}>
            <Input {...f("department")} list="department-options" autoComplete="off" />
            <Suggestions id="department-options" values={options.departments} />
          </Field>
          <Field label="Designation" htmlFor="jobTitle" required error={errors.jobTitle?.message}>
            <Input {...f("jobTitle")} list="designation-options" autoComplete="off" />
            <Suggestions id="designation-options" values={options.designations} />
          </Field>
          <Field label="Team" htmlFor="team" error={errors.team?.message} hint="Optional, e.g. Campus Hiring – South">
            <Input {...f("team")} list="team-options" autoComplete="off" />
            <Suggestions id="team-options" values={options.teams} />
          </Field>
          <Field label="Reporting manager" htmlFor="reportingManagerId" error={errors.reportingManagerId?.message} hint="Optional. Search the directory by name or employee ID.">
            <Controller
              control={control}
              name="reportingManagerId"
              render={({ field }) => (
                <ManagerPicker
                  id="reportingManagerId"
                  value={manager}
                  excludeId={mode.kind === "edit" ? mode.id : undefined}
                  disabled={isSubmitting}
                  invalid={Boolean(errors.reportingManagerId)}
                  describedBy={errors.reportingManagerId ? "reportingManagerId-error" : "reportingManagerId-hint"}
                  onChange={(p) => {
                    setManager(p);
                    field.onChange(p?.id ?? "");
                  }}
                />
              )}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Employment" title="Employment details" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Employment type" htmlFor="employmentType" error={errors.employmentType?.message}>
            <Select {...f("employmentType")}>
              <option value="">Not set</option>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EMPLOYMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          {mode.kind === "create" ? (
            <Field label="Employment status" htmlFor="employmentStatus" hint="Later changes use Deactivate / Reactivate / Record exit, which are audited.">
              <Select {...f("employmentStatus")}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          <Field label="Date of joining" htmlFor="joiningDate" error={errors.joiningDate?.message}>
            <Input type="date" {...f("joiningDate")} />
          </Field>
          <Field label="Work mode" htmlFor="workMode" error={errors.workMode?.message}>
            <Select {...f("workMode")}>
              <option value="">Not set</option>
              {WORK_MODES.map((m) => (
                <option key={m} value={m}>
                  {WORK_MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Work location" htmlFor="workLocation" error={errors.workLocation?.message} hint="Office city or site, e.g. Hyderabad">
            <Input {...f("workLocation")} list="location-options" autoComplete="off" />
            <Suggestions id="location-options" values={options.locations} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Attendance & leave" title="Attendance and leave references" description="Links to your attendance and leave systems. This app does not track attendance itself." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Attendance / biometric ID" htmlFor="attendanceRef" error={errors.attendanceRef?.message}>
            <Input {...f("attendanceRef")} autoComplete="off" />
          </Field>
          <Field label="Leave policy" htmlFor="leavePolicy" error={errors.leavePolicy?.message} hint="e.g. Standard – 24 days">
            <Input {...f("leavePolicy")} autoComplete="off" />
          </Field>
          <Field label="Leave / attendance record link" htmlFor="leaveSystemUrl" error={errors.leaveSystemUrl?.message} hint="Optional link to this employee in your HRMS." className="sm:col-span-2">
            <Input type="url" {...f("leaveSystemUrl")} placeholder="https://" autoComplete="off" />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Validity" title="Employee ID validity" description={mode.kind === "create" ? `Leave blank to issue today, valid for ${defaultValidityDays} days.` : "Dates of the employee ID card."} />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="ID issue date" htmlFor="idIssueDate" required={mode.kind === "edit"} error={errors.idIssueDate?.message}>
            <Input type="date" {...f("idIssueDate")} />
          </Field>
          <Field label="ID valid until" htmlFor="idExpiresAt" required={mode.kind === "edit"} error={errors.idExpiresAt?.message}>
            <Input type="date" {...f("idExpiresAt")} />
          </Field>
        </div>
      </Card>

      {mode.kind === "edit" && mode.exited && (
        <Card>
          <CardHeader eyebrow="Separation" title="Exit details" description="Correct the recorded exit. To undo an exit (rejoining), reactivate the employee from their profile." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Exit date (last working day)" htmlFor="exitDate" required error={errors.exitDate?.message}>
              <Input type="date" {...f("exitDate")} />
            </Field>
            <Field label="Exit type" htmlFor="exitType" required error={errors.exitType?.message}>
              <Select {...f("exitType")}>
                {EXIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EXIT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason / notes" htmlFor="exitReason" error={errors.exitReason?.message} className="sm:col-span-2">
              <Textarea {...f("exitReason")} maxLength={300} />
            </Field>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <ButtonLink href={mode.kind === "edit" ? `/employees/${mode.id}` : "/dashboard"} variant="secondary">
          Cancel
        </ButtonLink>
        <Button type="submit" loading={isSubmitting || progress !== null}>
          {mode.kind === "create" ? "Create employee" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
