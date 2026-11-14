"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, Eye, FileImage, FileText, FileUp, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn, formatDateTime } from "@/lib/cn";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from "@/features/employees/labels";
import { DOCUMENT_MAX_BYTES, documentTypeAllowed } from "@/features/directory/schema";
import type { DocumentRow } from "@/server/services/documents";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Upload with progress (fetch has no upload progress events): raw body + metadata header. */
function uploadDocument(employeeId: string, file: File, meta: { category: string; title: string; fileName: string }, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/employees/${employeeId}/documents`);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("X-Document-Meta", encodeURIComponent(JSON.stringify(meta)));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = "Upload failed";
      try {
        message = JSON.parse(xhr.responseText)?.error?.message ?? message;
      } catch {}
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.send(file);
  });
}

function UploadForm({ employeeId, onDone }: { employeeId: string; onDone: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocumentCategory>("OFFER_LETTER");
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!documentTypeAllowed(f.type)) return setError("Use a PDF, JPEG, PNG or WebP file.");
    if (f.size > DOCUMENT_MAX_BYTES) return setError("Files must be 5 MB or smaller.");
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, 120));
  };

  return (
    <form
      className="space-y-4 border-b border-border bg-primary-50/30 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return setError("Choose a file first.");
        setProgress(0);
        setError(null);
        try {
          await uploadDocument(employeeId, file, { category, title: title.trim() || file.name, fileName: file.name }, setProgress);
          toast.success("Document uploaded");
          onDone();
          router.refresh();
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          setError(message);
          toast.error(message);
        } finally {
          setProgress(null);
        }
      }}
    >
      <label
        htmlFor="doc-file"
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
          "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-6 text-center transition-colors",
          dragOver ? "border-primary-500 bg-primary-50" : "border-border-strong bg-white/70 hover:bg-white",
        )}
      >
        <FileUp className="size-6 text-ink-subtle" aria-hidden />
        <span className="text-sm font-medium text-ink">{file ? file.name : "Drag a file here, or choose a file"}</span>
        <span className="text-xs text-ink-subtle">PDF, JPEG, PNG or WebP · up to 5 MB{file ? ` · ${formatSize(file.size)}` : ""}</span>
        <input
          id="doc-file"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="doc-category">
          <Select id="doc-category" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {DOCUMENT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" htmlFor="doc-title" hint={category === "ID_PROOF" ? "For Aadhaar, upload the masked version (only the last 4 digits visible)." : undefined}>
          <Input id="doc-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
      {progress !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-navy-100" role="progressbar" aria-label="Upload" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-primary-600 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone} disabled={progress !== null}>
          <X className="size-4" aria-hidden /> Cancel
        </Button>
        <Button type="submit" loading={progress !== null} disabled={!file}>
          Upload document
        </Button>
      </div>
    </form>
  );
}

/** Employee documents and employment records (restricted: document:read / document:manage). */
export function DocumentsPanel({ employeeId, documents, canManage }: { employeeId: string; documents: DocumentRow[]; canManage: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<DocumentRow | null>(null);
  const [busy, setBusy] = useState(false);
  const fileUrl = (d: DocumentRow, inline = false) => `/api/employees/${employeeId}/documents/${d.id}${inline ? "?inline=1" : ""}`;

  return (
    <Card>
      <ConfirmDialog
        open={removing !== null}
        busy={busy}
        options={{ title: `Delete “${removing?.title ?? "document"}”?`, description: "The file is permanently removed. This is recorded in the activity log.", confirmLabel: "Delete", tone: "danger" }}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          setBusy(true);
          try {
            await api(`/api/employees/${employeeId}/documents/${removing.id}`, { method: "DELETE" });
            toast.success("Document deleted");
            setRemoving(null);
            router.refresh();
          } catch (e) {
            toast.error(e instanceof ApiError ? e.message : "Could not delete the document");
          } finally {
            setBusy(false);
          }
        }}
      />
      <CardHeader
        eyebrow="Restricted"
        title="Documents & employment records"
        description="Offer letters, contracts, ID proofs and other records. Every download is recorded in the activity log."
        actions={
          canManage &&
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <FileUp className="size-4" aria-hidden /> Upload
            </Button>
          )
        }
      />
      {adding && <UploadForm employeeId={employeeId} onDone={() => setAdding(false)} />}
      {documents.length === 0 ? (
        <EmptyState icon={<FileText className="size-5" />} title="No documents yet" description={canManage ? "Upload the offer letter, contract or other records." : undefined} />
      ) : (
        <ul className="divide-y divide-border" data-testid="document-list">
          {documents.map((d) => {
            const isImage = d.contentType.startsWith("image/");
            const Icon = isImage ? FileImage : FileText;
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", isImage ? "bg-cyan-50 text-cyan-600" : "bg-danger-50 text-danger-700")}>
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{d.title}</p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-subtle">
                      <Badge tone="info" dot={false}>
                        {DOCUMENT_CATEGORY_LABELS[d.category]}
                      </Badge>
                      <span>{formatSize(d.size)}</span>
                      <span>
                        {formatDateTime(d.uploadedAt)}
                        {d.uploadedBy ? ` · ${d.uploadedBy}` : ""}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  {isImage && (
                    <a href={fileUrl(d, true)} target="_blank" rel="noopener" className="grid size-8 place-items-center rounded-lg text-ink-muted hover:bg-navy-100 hover:text-ink" aria-label={`View ${d.title}`}>
                      <Eye className="size-4" aria-hidden />
                    </a>
                  )}
                  <a href={fileUrl(d)} download={d.fileName} className="grid size-8 place-items-center rounded-lg text-ink-muted hover:bg-navy-100 hover:text-ink" aria-label={`Download ${d.title}`}>
                    <Download className="size-4" aria-hidden />
                  </a>
                  {canManage && (
                    <button type="button" onClick={() => setRemoving(d)} className="grid size-8 place-items-center rounded-lg text-ink-subtle hover:bg-danger-50 hover:text-danger-700" aria-label={`Delete ${d.title}`}>
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
