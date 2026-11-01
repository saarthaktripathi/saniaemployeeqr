"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, FileSpreadsheet, FileUp, X } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/primitives";

const TEMPLATE =
  "firstName,lastName,department,jobTitle,businessVertical,workLocation,workEmail,joiningDate,idIssueDate,idExpiresAt,employmentStatus\r\n" +
  "Asha,Verma,Recruitment,Talent Partner,Staffing,Hyderabad,,2026-01-15,,,ACTIVE\r\n";

const MAX_CSV = 1024 * 1024;
const MAX_XLSX = 5 * 1024 * 1024;

interface RowError {
  row: number;
  messages: string[];
}

interface ImportResult {
  created: number;
  skipped: number;
  codes: string[];
}

const isXlsx = (f: File) => /\.xlsx$/i.test(f.name) || f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function ImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);

  const choose = (f: File | undefined) => {
    setResult(null);
    setRowErrors([]);
    if (!f) return setFile(null);
    if (!isXlsx(f) && !/\.csv$/i.test(f.name) && f.type !== "text/csv") return toast.error("Choose a .csv or .xlsx file");
    if (f.size > (isXlsx(f) ? MAX_XLSX : MAX_CSV)) return toast.error(isXlsx(f) ? "Excel file is larger than 5 MB" : "CSV file is larger than 1 MB");
    setFile(f);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          eyebrow="Step 1"
          title="Prepare your file"
          description="CSV or Excel (.xlsx, first sheet). Required columns: firstName, department, jobTitle. Optional: lastName, displayName, workEmail, phone, businessVertical, workLocation, joiningDate, idIssueDate, idExpiresAt (YYYY-MM-DD or Excel dates), employmentStatus (ACTIVE / INACTIVE)."
        />
        <div className="p-5">
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
            download="sania-employee-import-template.csv"
            className="text-sm font-medium text-primary-600 hover:underline"
          >
            Download CSV template
          </a>
          <span className="ml-2 text-xs text-ink-subtle">(opens in Excel; save as .xlsx or .csv)</span>
        </div>
      </Card>
      <Card>
        <CardHeader eyebrow="Step 2" title="Upload and validate" description="Every row is checked first. If any row has a problem, nothing is imported." />
        <form
          className="space-y-4 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file) return;
            setBusy(true);
            setRowErrors([]);
            setResult(null);
            try {
              // Excel is converted to CSV in the browser, so the server validates one format.
              const csv = isXlsx(file) ? await (await import("@/lib/xlsx-import")).xlsxFileToCsv(file) : await file.text();
              if (new Blob([csv]).size > MAX_CSV) throw new ApiError("The sheet is too large (over 1 MB of data). Split it into smaller files.", 413, "PAYLOAD_TOO_LARGE");
              const res = await api<ImportResult>(`/api/employees/import?skipDuplicates=${skipDuplicates ? "1" : "0"}`, { raw: csv, contentType: "text/csv" });
              setResult(res);
              toast.success(`${res.created} employees imported${res.skipped ? `, ${res.skipped} already existed` : ""}`);
              router.refresh();
            } catch (err) {
              if (err instanceof ApiError) {
                toast.error(err.message);
                const rows = err.details?.rows;
                if (Array.isArray(rows)) setRowErrors(rows as RowError[]);
              } else toast.error("This file could not be read. Check that it is a valid .xlsx or .csv file.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label
            htmlFor="csv"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              choose(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
              dragOver ? "border-primary-500 bg-primary-50" : "border-border-strong bg-page/50 hover:bg-page",
            )}
          >
            {file && isXlsx(file) ? <FileSpreadsheet className="size-7 text-emerald-600" aria-hidden /> : <FileUp className="size-7 text-ink-subtle" aria-hidden />}
            <span className="text-sm font-medium text-ink">{file ? file.name : "Drag a file here, or choose a CSV / Excel file"}</span>
            <span className="text-xs text-ink-subtle">Max 500 rows · CSV up to 1 MB · Excel up to 5 MB</span>
            <input
              id="csv"
              type="file"
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                choose(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          {file && (
            <button type="button" onClick={() => choose(undefined)} className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink">
              <X className="size-3.5" aria-hidden /> Remove file
            </button>
          )}
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
        <Card className="animate-rise overflow-hidden" role="status">
          <div className="flex items-start gap-3 border-b border-border bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-4">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
            <div>
              <p className="font-semibold text-ink">Import complete</p>
              <p className="text-sm text-ink-muted">
                <strong>{result.created}</strong> created · <strong>{result.skipped}</strong> skipped as already existing
              </p>
            </div>
          </div>
          {result.codes.length > 0 && (
            <div className="px-5 py-4 text-sm">
              <p className="mb-2 text-ink-muted">New employee IDs:</p>
              <p className="font-mono text-xs leading-relaxed text-ink">
                {result.codes.slice(0, 40).join(", ")}
                {result.codes.length > 40 && ` … and ${result.codes.length - 40} more`}
              </p>
              <Link href="/dashboard?sort=createdAt&dir=desc" className="mt-3 inline-block text-sm font-medium text-primary-600 hover:underline">
                View in the directory →
              </Link>
            </div>
          )}
        </Card>
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
