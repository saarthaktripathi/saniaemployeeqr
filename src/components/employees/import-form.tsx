"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileUp } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/primitives";

const TEMPLATE =
  "firstName,lastName,department,jobTitle,businessVertical,workLocation,workEmail,joiningDate,idIssueDate,idExpiresAt\r\n" +
  "Asha,Verma,Recruitment,Talent Partner,Staffing,Hyderabad,,2026-01-15,,\r\n";

interface RowError {
  row: number;
  messages: string[];
}

export function ImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          eyebrow="Step 1"
          title="Prepare your file"
          description="Required columns: firstName, department, jobTitle. Optional: lastName, displayName, workEmail, phone, businessVertical, workLocation, joiningDate, idIssueDate, idExpiresAt (dates as YYYY-MM-DD)."
        />
        <div className="p-5">
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
            download="sania-employee-import-template.csv"
            className="text-sm font-medium text-primary-600 hover:underline"
          >
            Download CSV template
          </a>
        </div>
      </Card>
      <Card>
        <CardHeader eyebrow="Step 2" title="Upload" />
        <form
          className="space-y-4 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file) return;
            if (file.size > 1024 * 1024) return toast.error("File is larger than 1 MB");
            setBusy(true);
            setRowErrors([]);
            setResult(null);
            try {
              const res = await api<{ created: number; skipped: number }>(`/api/employees/import?skipDuplicates=${skipDuplicates ? "1" : "0"}`, {
                raw: await file.text(),
                contentType: "text/csv",
              });
              setResult(res);
              toast.success(`${res.created} employees imported${res.skipped ? `, ${res.skipped} already existed` : ""}`);
              router.refresh();
            } catch (err) {
              if (err instanceof ApiError) {
                toast.error(err.message);
                const rows = err.details?.rows;
                if (Array.isArray(rows)) setRowErrors(rows as RowError[]);
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="csv" className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border-strong bg-page/50 px-6 py-8 text-center hover:bg-page">
            <FileUp className="size-6 text-ink-subtle" aria-hidden />
            <span className="text-sm font-medium text-ink">{file ? file.name : "Choose a CSV file"}</span>
            <span className="text-xs text-ink-subtle">Max 500 rows, 1 MB</span>
            <input id="csv" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" className="mt-0.5 size-4 accent-primary-600" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
            <span>
              Skip employees that already exist
              <span className="block text-xs text-ink-subtle">Rows matching an existing record (same name, department, job title, location, joining date, phone and email) are not created again — safe if a file is uploaded twice.</span>
            </span>
          </label>
          <Button type="submit" disabled={!file} loading={busy}>
            Validate and import
          </Button>
        </form>
      </Card>
      {result && (
        <Alert tone="success" title={`${result.created} employees created`}>
          {result.skipped > 0 && `${result.skipped} rows were skipped because those employees already exist. `}
          Each new employee received a unique employee ID. Issue QR credentials from their profiles.
        </Alert>
      )}
      {rowErrors.length > 0 && (
        <Alert tone="danger" title="Fix these rows and upload again">
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {rowErrors.map((r) => (
              <li key={r.row}>
                Row {r.row}: {r.messages.join("; ")}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
