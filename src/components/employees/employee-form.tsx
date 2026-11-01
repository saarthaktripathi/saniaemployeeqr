"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Card, CardHeader } from "@/components/ui/primitives";
import { employeeCreateSchema, employeeEditFormSchema } from "@/features/employees/schema";
import { deleteEmployeePhoto, PhotoUpload, uploadEmployeePhoto, type PhotoChange } from "./photo-upload";

export interface EmployeeFormValues {
  firstName: string;
  lastName: string;
  displayName: string;
  workEmail: string;
  phone: string;
  department: string;
  jobTitle: string;
  businessVertical: string;
  workLocation: string;
  joiningDate: string;
  idIssueDate: string;
  idExpiresAt: string;
  /** Create only: initial employment status. */
  employmentStatus: "ACTIVE" | "INACTIVE";
}

const empty: EmployeeFormValues = {
  firstName: "",
  lastName: "",
  displayName: "",
  workEmail: "",
  phone: "",
  department: "",
  jobTitle: "",
  businessVertical: "",
  workLocation: "",
  joiningDate: "",
  idIssueDate: "",
  idExpiresAt: "",
  employmentStatus: "ACTIVE",
};

type Mode = { kind: "create" } | { kind: "edit"; id: string; version: number };

export function EmployeeForm({
  mode,
  initial,
  departments,
  defaultValidityDays,
  photoUrl = null,
}: {
  mode: Mode;
  initial?: Partial<EmployeeFormValues>;
  departments: string[];
  defaultValidityDays: number;
  /** Current photo (edit mode). */
  photoUrl?: string | null;
}) {
  const router = useRouter();
  const photo = useRef<PhotoChange>({ kind: "keep" });
  const onPhotoChange = useCallback((c: PhotoChange) => {
    photo.current = c;
  }, []);
  const [progress, setProgress] = useState<number | null>(null);
  const schema = mode.kind === "create" ? employeeCreateSchema : employeeEditFormSchema;
  const {
    register,
    handleSubmit,
    getValues,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFormValues>({
    defaultValues: { ...empty, ...initial },
    // Client-side validation mirrors the server schema; the server remains authoritative.
    resolver: zodResolver(schema as unknown as z.ZodType<EmployeeFormValues, EmployeeFormValues>),
    mode: "onBlur",
  });

  const submit = async () => {
    // Send the raw string values: handleSubmit receives the schema's transformed output
    // (e.g. Date objects), which the server's YYYY-MM-DD validation would reject.
    const { employmentStatus, ...values } = getValues();
    try {
      let id: string;
      if (mode.kind === "create") {
        const { employee } = await api<{ employee: { id: string; employeeCode: string } }>("/api/employees", { body: { ...values, employmentStatus } });
        id = employee.id;
        toast.success(`Employee created — ${employee.employeeCode}`);
      } else {
        id = mode.id;
        await api(`/api/employees/${id}`, { method: "PATCH", body: { ...values, version: mode.version } });
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

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Card>
        <CardHeader eyebrow="Profile" title="Photo & personal details" description="The photo and name appear on the digital employee ID card and the verification page." />
        <div className="grid gap-6 p-5 md:grid-cols-[260px_1fr]">
          <PhotoUpload
            name={nameParts.filter(Boolean).join(" ")}
            existingUrl={photoUrl}
            onChange={onPhotoChange}
            disabled={isSubmitting}
            progress={progress}
          />
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
          <Field label="Work email" htmlFor="workEmail" error={errors.workEmail?.message} hint="Optional. Private — never shown publicly.">
            <Input type="email" {...f("workEmail")} autoComplete="off" />
          </Field>
          <Field label="Phone" htmlFor="phone" error={errors.phone?.message} hint="Optional. Private — never shown publicly.">
            <Input type="tel" {...f("phone")} autoComplete="off" />
          </Field>
        </div>
        </div>
      </Card>

      <Card>
        <CardHeader eyebrow="Role" title="Employment details" description="These fields may appear on the public verification page, per System Rules." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Department" htmlFor="department" required error={errors.department?.message}>
            <Input {...f("department")} list="department-options" autoComplete="off" />
            <datalist id="department-options">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label="Approved job title" htmlFor="jobTitle" required error={errors.jobTitle?.message}>
            <Input {...f("jobTitle")} autoComplete="off" />
          </Field>
          <Field label="Business vertical" htmlFor="businessVertical" error={errors.businessVertical?.message}>
            <Input {...f("businessVertical")} autoComplete="off" />
          </Field>
          <Field label="Work location" htmlFor="workLocation" error={errors.workLocation?.message}>
            <Input {...f("workLocation")} autoComplete="off" />
          </Field>
          <Field label="Joining date" htmlFor="joiningDate" error={errors.joiningDate?.message}>
            <Input type="date" {...f("joiningDate")} />
          </Field>
          {mode.kind === "create" && (
            <Field label="Employment status" htmlFor="employmentStatus" hint="Later changes use Deactivate / Reactivate, which are audited.">
              <Select {...f("employmentStatus")}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </Field>
          )}
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
