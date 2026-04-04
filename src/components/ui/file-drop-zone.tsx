"use client";

import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from "react";
import { Upload, FileText, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

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

const ACCEPTED_EXTENSIONS = [".eml", ".msg", ".docx", ".pdf", ".txt"];

// ============================================================
// TEXT EXTRACTION
// ============================================================

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read a File as plain text */
function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/** Read a File as ArrayBuffer */
function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extract text from a .docx file (which is a ZIP containing word/document.xml).
 * Uses a simple approach: find the XML content and strip tags.
 * No external dependencies required.
 */
async function extractDocxText(file: File): Promise<string> {
  const buffer = await readAsArrayBuffer(file);
  const bytes = new Uint8Array(buffer);

  // .docx is a ZIP file. We need to find word/document.xml inside it.
  // Simple approach: search for the XML content between known markers.
  const decoder = new TextDecoder("utf-8");
  const fullText = decoder.decode(bytes);

  // Find the document.xml content — it contains <w:t> tags with text
  const docXmlMatch = fullText.match(/<w:body[\s\S]*?<\/w:body>/);
  if (!docXmlMatch) {
    throw new Error("Could not find document content in .docx file. Try copying the text and pasting below.");
  }

  // Extract text from <w:t> tags, splitting on paragraph boundaries
  const paragraphs = docXmlMatch[0].split(/<\/w:p>/);
  const result: string[] = [];

  for (const para of paragraphs) {
    const parts: string[] = [];
    const innerRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let innerMatch;
    while ((innerMatch = innerRegex.exec(para)) !== null) {
      parts.push(innerMatch[1]);
    }
    if (parts.length > 0) {
      result.push(parts.join(""));
    }
  }

  const extracted = result.join("\n");
  if (!extracted.trim()) {
    throw new Error("No text content found in .docx file. Try copying the text and pasting below.");
  }

  return extracted;
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

      const ext = getExtension(file.name);

      try {
        // Validate extension
        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
          throw new Error(
            `Unsupported file type "${ext}". Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}`
          );
        }

        // Size check (10MB max)
        if (file.size > 10 * 1024 * 1024) {
          throw new Error("File is too large (max 10 MB).");
        }

        let text: string;

        switch (ext) {
          case ".txt":
          case ".eml":
            text = await readAsText(file);
            break;

          case ".docx":
            text = await extractDocxText(file);
            break;

          case ".msg":
            throw new Error(
              "MSG files use a binary format that requires server-side conversion. Please open the email in Outlook, copy the text, and paste it in the text area below."
            );

          case ".pdf":
            throw new Error(
              "PDF text extraction is coming soon. For now, please open the PDF, copy the text, and paste it in the text area below."
            );

          default:
            throw new Error(`Unsupported file type: ${ext}`);
        }

        if (!text.trim()) {
          throw new Error("The file appears to be empty. Try pasting the email text manually.");
        }

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
          accept={ACCEPTED_EXTENSIONS.join(",")}
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
