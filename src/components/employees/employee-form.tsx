"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Card, CardHeader } from "@/components/ui/primitives";
import { employeeCreateSchema, employeeEditFormSchema } from "@/features/employees/schema";

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
};

type Mode = { kind: "create" } | { kind: "edit"; id: string; version: number };

export function EmployeeForm({ mode, initial, departments, defaultValidityDays }: { mode: Mode; initial?: Partial<EmployeeFormValues>; departments: string[]; defaultValidityDays: number }) {
  const router = useRouter();
  const schema = mode.kind === "create" ? employeeCreateSchema : employeeEditFormSchema;
  const {
    register,
    handleSubmit,
    getValues,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EmployeeFormValues>({
    defaultValues: { ...empty, ...initial },
    // Client-side validation mirrors the server schema; the server remains authoritative.
    resolver: zodResolver(schema as unknown as z.ZodType<EmployeeFormValues, EmployeeFormValues>),
    mode: "onBlur",
  });

  const onSubmit = handleSubmit(async () => {
    // Send the raw string values: handleSubmit receives the schema's transformed output
    // (e.g. Date objects), which the server's YYYY-MM-DD validation would reject.
    const values = getValues();
    try {
      if (mode.kind === "create") {
        const { employee } = await api<{ employee: { id: string; employeeCode: string } }>("/api/employees", { body: values });
        toast.success(`Employee created — ${employee.employeeCode}`);
        router.push(`/employees/${employee.id}`);
      } else {
        await api(`/api/employees/${mode.id}`, { method: "PATCH", body: { ...values, version: mode.version } });
        toast.success("Changes saved");
        router.push(`/employees/${mode.id}`);
      }
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
  });

  const f = (name: keyof EmployeeFormValues) => ({
    id: name,
    ...register(name),
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <Card>
        <CardHeader eyebrow="Profile" title="Personal details" description="Name as it should appear on the employee ID." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
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
        <Button type="submit" loading={isSubmitting}>
          {mode.kind === "create" ? "Create employee" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
