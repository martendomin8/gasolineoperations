"use client";

// DocumentsSection — compact button summary on the linkage page that opens
// a modal with a drop zone + the list of uploaded documents.
//
// One drop zone for any document type (CP recap, Q88, SOF, NOR, vessel
// nomination, doc instructions, BL, COA, stock report, GTC, SPA, etc.).
// The AI classifier server-side picks the most likely type; operator
// reviews + overrides via the per-row dropdown if the classifier got it
// wrong. Parsers themselves are dispatched separately once Arne provides
// real document samples to ground them in (vessel_nomination, SOF and
// doc_instructions parsers are scaffolded but waiting for samples).
//
// Mirrors the CostsSection pattern (button → modal) so the linkage page
// stays compact — Lean Startup constraint: linkage view must not bloat.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  Upload,
  X,
  ArrowRight,
  FileText,
  AlertCircle,
  Trash2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

// Document types known to the catalog. Mirrors DocumentFileType from
// schema.ts but kept inline so this component doesn't reach into server
// types; the classifier and the override dropdown share the same list.
const DOC_TYPES = [
  "cp_recap",
  "q88",
  "sof",
  "nor",
  "vessel_nomination",
  "doc_instructions",
  "bl",
  "coa",
  "stock_report",
  "gtc",
  "spa",
  "deal_recap",
  "other",
] as const;
type DocType = (typeof DOC_TYPES)[number];

const DOC_TYPE_LABEL: Record<DocType, string> = {
  cp_recap: "CP Recap",
  q88: "Q88",
  sof: "Statement of Facts",
  nor: "Notice of Readiness",
  vessel_nomination: "Vessel Nomination",
  doc_instructions: "Doc Instructions",
  bl: "Bill of Lading",
  coa: "Certificate of Analysis",
  stock_report: "Stock Report",
  gtc: "GTC",
  spa: "SPA / Cargo Contract",
  deal_recap: "Deal Recap",
  other: "Other",
};

// Group order in the modal — most frequently used at top.
const DOC_TYPE_GROUP_ORDER: DocType[] = [
  "cp_recap",
  "q88",
  "vessel_nomination",
  "doc_instructions",
  "sof",
  "nor",
  "bl",
  "coa",
  "stock_report",
  "spa",
  "gtc",
  "deal_recap",
  "other",
];

export interface LinkageDocumentRow {
  id: string;
  filename: string;
  fileType: string;
  storagePath: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  parsedData?: unknown;
  parserConfidence?: string | null;
  parserClassifierLabel?: string | null;
  parserClassifierConfidence?: string | null;
  createdAt: string;
}

interface Props {
  linkageId: string;
  canEdit: boolean;
  onUpdated: () => void;
}

const ACCEPTED_FILES = ".pdf,.doc,.docx,.eml,.msg,.txt";
const MAX_BYTES = 20 * 1024 * 1024;

export function DocumentsSection({ linkageId, canEdit, onUpdated }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [docs, setDocs] = useState<LinkageDocumentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/linkages/${linkageId}/documents`);
      if (res.ok) {
        const data = await res.json();
        setDocs(data.documents ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [linkageId]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // Re-fetch when the modal opens so a doc uploaded by another tab shows up.
  useEffect(() => {
    if (modalOpen) fetchDocs();
  }, [modalOpen, fetchDocs]);

  // Esc closes the modal.
  useEffect(() => {
    if (!modalOpen) return;
    const handler = (e: KeyboardEvent) => e.key === "Escape" && setModalOpen(false);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modalOpen]);

  const handleUpload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      setUploading(true);
      const failed: string[] = [];
      const lowConfidence: Array<{ name: string; type: string; confidence: number }> = [];

      for (const file of list) {
        if (file.size > MAX_BYTES) {
          failed.push(`${file.name} (>20MB)`);
          continue;
        }
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("fileType", "auto");
          const res = await fetch(`/api/linkages/${linkageId}/documents`, {
            method: "POST",
            body: fd,
          });
          if (!res.ok) {
            failed.push(file.name);
            continue;
          }
          const data = await res.json();
          const cls = data.classification;
          if (cls && typeof cls.confidence === "number" && cls.confidence < 0.7) {
            lowConfidence.push({ name: file.name, type: cls.type, confidence: cls.confidence });
          }
        } catch {
          failed.push(file.name);
        }
      }
      setUploading(false);

      if (failed.length > 0) {
        toast.error(`Upload failed: ${failed.join(", ")}`);
      } else {
        toast.success(
          list.length === 1 ? `Uploaded ${list[0].name}` : `Uploaded ${list.length} files`
        );
      }
      if (lowConfidence.length > 0) {
        const first = lowConfidence[0];
        toast.warning(
          `Low classifier confidence on "${first.name}" — pick the right type from the dropdown if AI got it wrong.`
        );
      }

      await fetchDocs();
      onUpdated();
    },
    [linkageId, fetchDocs, onUpdated]
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit || uploading) return;
    if (e.dataTransfer.files.length > 0) void handleUpload(e.dataTransfer.files);
  };

  const handleTypeChange = async (docId: string, newType: DocType) => {
    try {
      const res = await fetch(`/api/linkages/${linkageId}/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileType: newType }),
      });
      if (!res.ok) {
        toast.error("Failed to update doc type");
        return;
      }
      toast.success("Doc type updated");
      await fetchDocs();
      onUpdated();
    } catch {
      toast.error("Failed to update doc type");
    }
  };

  const handleDelete = async (docId: string) => {
    try {
      const res = await fetch(`/api/linkages/${linkageId}/documents/${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Failed to delete document");
        return;
      }
      toast.success("Document deleted");
      await fetchDocs();
      onUpdated();
    } catch {
      toast.error("Failed to delete document");
    }
  };

  // Group by fileType for the modal list.
  const grouped = useMemo(() => {
    const map = new Map<string, LinkageDocumentRow[]>();
    for (const d of docs) {
      const arr = map.get(d.fileType) ?? [];
      arr.push(d);
      map.set(d.fileType, arr);
    }
    return DOC_TYPE_GROUP_ORDER.filter((t) => map.has(t)).map((t) => ({
      type: t,
      label: DOC_TYPE_LABEL[t],
      items: map.get(t)!,
    }));
  }, [docs]);

  const totalCount = docs.length;
  const lowConfidenceCount = docs.filter(
    (d) =>
      d.parserClassifierConfidence != null &&
      Number(d.parserClassifierConfidence) > 0 &&
      Number(d.parserClassifierConfidence) < 0.7
  ).length;

  return (
    <>
      {/* Compact summary row in the linkage page — opens the modal on click. */}
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] transition-colors text-left"
      >
        <FolderOpen className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
          Documents
        </span>
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          · {totalCount === 0 ? "no files yet" : `${totalCount} file${totalCount === 1 ? "" : "s"}`}
        </span>
        {lowConfidenceCount > 0 && (
          <span className="text-[10px] text-amber-400 uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {lowConfidenceCount} need review
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">
          <span>Drag & drop</span>
          <ArrowRight className="h-3 w-3 opacity-60" />
        </span>
      </button>

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center px-4 py-8"
          onClick={() => setModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Linkage documents"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-[var(--color-accent)]" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-primary)]">
                  Documents
                </h3>
                <span className="text-[11px] text-[var(--color-text-tertiary)]">
                  {totalCount} file{totalCount === 1 ? "" : "s"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] rounded"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Drop zone */}
              {canEdit && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`group relative cursor-pointer rounded-[var(--radius-md)] border-2 border-dashed transition-all ${
                    dragOver
                      ? "border-indigo-500/60 bg-indigo-500/10"
                      : "border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] hover:border-[var(--color-border-default)]"
                  } px-4 py-8 text-center`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ACCEPTED_FILES}
                    onChange={(e) => {
                      if (e.target.files) void handleUpload(e.target.files);
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                  <Upload
                    className={`h-6 w-6 mx-auto mb-2 ${
                      dragOver ? "text-indigo-400" : "text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)]"
                    }`}
                  />
                  <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                    {uploading
                      ? "Uploading…"
                      : dragOver
                      ? "Drop to upload"
                      : "Drag & drop or click to upload"}
                  </p>
                  <p className="text-[10px] mt-1 text-[var(--color-text-tertiary)] inline-flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3" />
                    AI classifies the type — operator reviews below.
                  </p>
                  <p className="text-[10px] mt-0.5 text-[var(--color-text-tertiary)]">
                    PDF / DOC / DOCX / EML / MSG / TXT · max 20MB each
                  </p>
                </div>
              )}

              {/* Doc list grouped by type */}
              {loading && docs.length === 0 ? (
                <div className="text-center py-6 text-[11px] text-[var(--color-text-tertiary)]">
                  Loading…
                </div>
              ) : grouped.length === 0 ? (
                <div className="text-center py-6 text-[11px] text-[var(--color-text-tertiary)]">
                  No documents uploaded yet.
                </div>
              ) : (
                grouped.map((group) => (
                  <div key={group.type} className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
                      <span>{group.label}</span>
                      <span className="text-[10px] opacity-60">· {group.items.length}</span>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] divide-y divide-[var(--color-border-subtle)]">
                      {group.items.map((doc) => {
                        const conf = doc.parserClassifierConfidence
                          ? Number(doc.parserClassifierConfidence)
                          : null;
                        const lowConf = conf !== null && conf > 0 && conf < 0.7;
                        return (
                          <div
                            key={doc.id}
                            className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--color-surface-2)]"
                          >
                            <FileText className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                {doc.storagePath ? (
                                  <a
                                    href={doc.storagePath}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[var(--color-text-primary)] hover:underline truncate"
                                  >
                                    {doc.filename}
                                  </a>
                                ) : (
                                  <span className="text-[var(--color-text-primary)] truncate">
                                    {doc.filename}
                                  </span>
                                )}
                                {lowConf && (
                                  <span
                                    title={`Classifier confidence ${(conf! * 100).toFixed(0)}% — please verify type`}
                                    className="text-[10px] text-amber-400 inline-flex items-center gap-1"
                                  >
                                    <AlertCircle className="h-3 w-3" />
                                    {(conf! * 100).toFixed(0)}%
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-[var(--color-text-tertiary)]">
                                {new Date(doc.createdAt).toLocaleString()}
                                {doc.sizeBytes ? ` · ${formatBytes(doc.sizeBytes)}` : ""}
                              </div>
                            </div>
                            {canEdit && (
                              <select
                                value={doc.fileType}
                                onChange={(e) => handleTypeChange(doc.id, e.target.value as DocType)}
                                className="text-[11px] bg-[var(--color-surface-3)] border border-[var(--color-border-subtle)] rounded px-1.5 py-0.5 text-[var(--color-text-secondary)]"
                                title="Override classifier"
                              >
                                {DOC_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {DOC_TYPE_LABEL[t]}
                                  </option>
                                ))}
                              </select>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => handleDelete(doc.id)}
                                className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)]"
                                aria-label="Delete document"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] flex items-center justify-between gap-2 text-[10px] text-[var(--color-text-tertiary)]">
              <span>
                Per-doc-type parsers (vessel_nomination, SOF, doc_instructions) are scaffolded;
                detailed extraction lands once Arne provides real document samples.
              </span>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
