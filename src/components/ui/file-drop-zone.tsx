"use client";

import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from "react";
import { Upload, FileText, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  ACCEPTED_FILE_EXTENSIONS,
  extractTextFromFile,
} from "@/lib/utils/extract-file-text";

// ============================================================
// TYPES
// ============================================================

interface FileDropZoneProps {
  /** Called with the extracted text content from the dropped/selected file */
  onTextExtracted: (text: string, filename: string) => void;
  /** Optional class for the outer wrapper */
  className?: string;
  /** Whether parsing is in progress (disables drop) */
  disabled?: boolean;
}

interface UploadedFile {
  name: string;
  size: number;
  type: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================
// COMPONENT
// ============================================================

export function FileDropZone({ onTextExtracted, className, disabled }: FileDropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);
      setProcessing(true);

      try {
        const text = await extractTextFromFile(file);
        const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
        setUploadedFile({ name: file.name, size: file.size, type: ext });
        onTextExtracted(text, file.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to process file.");
        setUploadedFile(null);
      } finally {
        setProcessing(false);
      }
    },
    [onTextExtracted]
  );

  // ── Drag handlers ──────────────────────────────────────────

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && !processing) setDragOver(true);
    },
    [disabled, processing]
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      if (disabled || processing) return;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFile(files[0]);
      }
    },
    [disabled, processing, processFile]
  );

  // ── File input handler ─────────────────────────────────────

  const handleFileSelect = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        processFile(files[0]);
      }
      // Reset so the same file can be re-selected
      if (inputRef.current) inputRef.current.value = "";
    },
    [processFile]
  );

  const handleClear = useCallback(() => {
    setUploadedFile(null);
    setError(null);
  }, []);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className={cn("space-y-2", className)}>
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && !processing && inputRef.current?.click()}
        className={cn(
          "relative flex flex-col items-center justify-center gap-2 p-6 rounded-[var(--radius-lg)]",
          "border-2 border-dashed cursor-pointer transition-all duration-150",
          dragOver
            ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
            : "border-[var(--color-border-default)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-1)]",
          (disabled || processing) && "opacity-50 cursor-not-allowed"
        )}
      >
        {processing ? (
          <>
            <div className="h-6 w-6 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
            <p className="text-sm text-[var(--color-text-secondary)]">Processing file...</p>
          </>
        ) : (
          <>
            <Upload
              className={cn(
                "h-6 w-6",
                dragOver ? "text-[var(--color-accent)]" : "text-[var(--color-text-tertiary)]"
              )}
            />
            <div className="text-center">
              <p className="text-sm text-[var(--color-text-secondary)]">
                Drop email file here
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                .eml .txt .docx — or{" "}
                <span className="text-[var(--color-accent)] underline underline-offset-2">
                  browse files
                </span>
              </p>
            </div>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_FILE_EXTENSIONS.join(",")}
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Uploaded file indicator */}
      {uploadedFile && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)]">
          <FileText className="h-4 w-4 text-[var(--color-accent)] flex-shrink-0" />
          <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">
            {uploadedFile.name}
          </span>
          <span className="text-xs text-[var(--color-text-tertiary)]">
            ({formatFileSize(uploadedFile.size)})
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            className="ml-auto text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] border border-[var(--color-accent)] border-opacity-30">
          <AlertTriangle className="h-4 w-4 text-[var(--color-accent)] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--color-accent-text)]">{error}</p>
        </div>
      )}
    </div>
  );
}
