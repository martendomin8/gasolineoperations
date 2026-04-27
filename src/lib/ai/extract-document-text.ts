// Generic text extraction from binary documents (PDF / DOC / DOCX / MSG / EML).
// All AI parsers consume plain text, so we centralise extraction here. The
// per-doc-type parsers (parseQ88, parseVesselNomination, parseSof, etc.)
// then operate on the returned string without caring about the file format.
//
// Why a separate util (vs. inlined in each parser): keeps file-format
// concerns (PDF library upgrades, .msg quirks, .eml multipart) in one
// place. New parsers don't need to re-handle MIME edge cases.

import { isEmailFile, parseEmail } from "@/lib/ai/parse-email";

export interface ExtractedDocument {
  /** Plain text content, suitable for feeding to an LLM. */
  text: string;
  /** Detected file format that drove the extraction path. */
  format: "pdf" | "docx" | "doc" | "eml" | "msg" | "text" | "unknown";
  /**
   * Email metadata when the source was an email — caller can show
   * subject/from in the confirm modal. Null for non-email sources.
   */
  email: {
    subject: string | null;
    from: string | null;
    receivedAt: string | null;
    attachmentCount: number;
  } | null;
}

/**
 * Extract plain text from a document buffer.
 *
 * For email files (.eml / .msg) the body is returned along with subject/from
 * metadata. Attachments inside the email are NOT recursively extracted —
 * the caller is expected to handle attachment routing separately (e.g. the
 * upload endpoint already auto-imports email attachments as their own
 * documents).
 */
export async function extractDocumentText(
  buffer: Buffer,
  fileName: string,
  mimeType?: string
): Promise<ExtractedDocument> {
  const lowerName = fileName.toLowerCase();
  const ext = (lowerName.match(/\.[^.]+$/)?.[0] ?? "").replace(/^\./, "");

  // Email path — pull body + metadata.
  if (isEmailFile(fileName) || mimeType === "message/rfc822" || ext === "eml") {
    try {
      const parsed = await parseEmail(buffer);
      const body = (parsed.bodyText ?? "").trim();
      return {
        text: body,
        format: ext === "msg" ? "msg" : "eml",
        email: {
          subject: parsed.subject ?? null,
          from: parsed.from ?? null,
          receivedAt: parsed.date?.toISOString() ?? null,
          attachmentCount: parsed.attachments?.length ?? 0,
        },
      };
    } catch (err) {
      // Fall through to raw-text attempt
      console.warn(`[extract-document-text] email parse failed for ${fileName}:`, err);
    }
  }

  if (ext === "pdf" || mimeType === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({
      data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    });
    const result = await parser.getText();
    return { text: result.text ?? "", format: "pdf", email: null };
  }

  if (
    ext === "docx" ||
    ext === "doc" ||
    mimeType === "application/msword" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value ?? "", format: ext === "doc" ? "doc" : "docx", email: null };
  }

  // Try as UTF-8 text — covers raw .txt drops and our own pasted text inputs.
  try {
    const text = buffer.toString("utf8").trim();
    if (text.length > 0) {
      return { text, format: "text", email: null };
    }
  } catch {
    // ignore
  }

  return { text: "", format: "unknown", email: null };
}
