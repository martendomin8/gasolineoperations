/**
 * Email parsing for CP recap drops that arrive as .eml / .msg.
 *
 * Real-world flow: a chartering broker emails NEFGO an .eml containing the
 * recap text in the body and the Q88 PDF as an attachment. The operator
 * drags the .eml onto the "Drop CP Recap here" zone. This module pulls the
 * email apart so the upload route can persist (a) the email itself as the
 * cp_recap document, (b) any Q88 attachments as separate q88 documents,
 * and (c) any other attachments classified as bl / coa / other.
 *
 * Library: `mailparser` (.eml only). `.msg` (Outlook proprietary) needs a
 * separate library — currently we treat .msg as opaque and just store it.
 */

import { simpleParser, type Attachment as MailAttachment } from "mailparser";
import path from "path";

// ============================================================
// TYPES
// ============================================================

export interface ParsedEmailAttachment {
  filename: string;
  contentType: string;
  size: number;
  data: Buffer;
  /** What we believe this attachment is, based on filename + content sniffing. */
  classification: AttachmentClassification;
}

export type AttachmentClassification = "q88" | "cp_recap" | "bl" | "coa" | "other";

export interface ParsedEmail {
  from: string | null;
  to: string | null;
  subject: string | null;
  date: Date | null;
  /** Plain-text body. If the email was HTML-only, this is the text fallback
   *  produced by mailparser. */
  bodyText: string;
  attachments: ParsedEmailAttachment[];
}

// ============================================================
// FILE-TYPE DETECTION
// ============================================================

/** True if the filename has an email-container extension that this module
 *  knows how to parse. */
export function isEmailFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ext === ".eml"; // .msg requires a different parser; not handled here.
}

/** True if the filename suggests this is the Outlook proprietary .msg
 *  format. Caller should treat it as opaque (store but don't parse). */
export function isOutlookMsg(filename: string): boolean {
  return path.extname(filename).toLowerCase() === ".msg";
}

// ============================================================
// ATTACHMENT CLASSIFICATION
// ============================================================

/**
 * Classify an attachment by filename heuristic plus a content sniff for the
 * common cases. Order matters: Q88 detection runs first because that's the
 * only attachment type we currently auto-import + auto-parse downstream.
 *
 * The classification is best-effort. The upload route still respects the
 * fileType the operator chose for the parent file — this only auto-routes
 * email attachments to the right slot.
 */
export function classifyAttachment(
  filename: string,
  contentType: string,
  data: Buffer
): AttachmentClassification {
  const nameLower = filename.toLowerCase();
  const ext = path.extname(nameLower);

  // ---- Q88 ---------------------------------------------------------------
  // Filename heuristic catches the dominant case (`<Vessel>_Q88.pdf`,
  // `q88-mtmkobe-2024.pdf`, etc.). Content sniff is the fallback.
  if (/q\s*88|q88/i.test(filename)) {
    return "q88";
  }
  if ((ext === ".pdf" || ext === ".txt") && containsQ88Markers(data)) {
    return "q88";
  }

  // ---- Bill of Lading ----------------------------------------------------
  if (/\bb[\s_-]?\/?l\b|bill[\s_-]?of[\s_-]?lading|bol/i.test(filename)) {
    return "bl";
  }

  // ---- Certificate of Analysis ------------------------------------------
  if (/\bcoa\b|certificate[\s_-]?of[\s_-]?analysis/i.test(filename)) {
    return "coa";
  }

  // ---- CP Recap (rare as attachment when email body already holds it,
  // but possible if recap was sent as a Word doc rather than in body) ----
  if (/recap|fixture|charter[\s_-]?party|cp[\s_-]?\d{2}\.\d{2}\.\d{4}/i.test(filename)) {
    return "cp_recap";
  }

  return "other";
}

/** Sniff the first ~4KB of an attachment for hallmark Q88 phrases. Works
 *  on plain text and on text-extractable PDFs (where the title page text
 *  is usually visible inside the binary stream). */
function containsQ88Markers(data: Buffer): boolean {
  // 4KB is enough to catch the title block in nearly all Q88 forms; reading
  // more would slow large-batch ingest without improving accuracy.
  const head = data.slice(0, 4096).toString("utf8", 0, Math.min(4096, data.length));
  const markers = [
    "VESSEL PARTICULARS QUESTIONNAIRE",
    "OCIMF",
    "INTERTANKO",
    "Q88.com",
    "SHIP'S TANKER QUESTIONNAIRE",
    "TANKER QUESTIONNAIRE",
  ];
  return markers.some((m) => head.toUpperCase().includes(m));
}

// ============================================================
// EMAIL PARSING
// ============================================================

/**
 * Parse a raw .eml buffer into headers, plain-text body and classified
 * attachments. Throws on malformed input (the caller should surface the
 * error to the operator).
 */
export async function parseEmail(buffer: Buffer): Promise<ParsedEmail> {
  const parsed = await simpleParser(buffer, {
    skipHtmlToText: false, // Generate text fallback if email is HTML-only.
    skipImageLinks: true,  // We don't follow embedded images.
  });

  const attachments: ParsedEmailAttachment[] = [];
  for (const att of parsed.attachments ?? []) {
    const filename = pickAttachmentFilename(att);
    const contentType = att.contentType ?? "application/octet-stream";
    const data = att.content as Buffer;
    if (!data || data.length === 0) continue;

    attachments.push({
      filename,
      contentType,
      size: data.length,
      data,
      classification: classifyAttachment(filename, contentType, data),
    });
  }

  // Plain text body: prefer .text (already-extracted plain), fall back to
  // .html stripped to text if only HTML was provided. mailparser types
  // .html as `string | false`, so guard the type before passing it on.
  const html = typeof parsed.html === "string" ? parsed.html : "";
  const bodyText = parsed.text ?? stripHtml(html);

  return {
    from: parsed.from?.text ?? null,
    to: Array.isArray(parsed.to)
      ? parsed.to.map((t) => t.text).join(", ")
      : parsed.to?.text ?? null,
    subject: parsed.subject ?? null,
    date: parsed.date ?? null,
    bodyText,
    attachments,
  };
}

function pickAttachmentFilename(att: MailAttachment): string {
  // mailparser may set filename, contentDisposition.filename, or fall back
  // to a generated name. Prefer the explicit filename header, then sanitise.
  const raw = att.filename || (att as { generatedFileName?: string }).generatedFileName || "attachment";
  return raw.replace(/[\r\n]/g, "").trim();
}

function stripHtml(html: string): string {
  // Minimal HTML stripping for the fallback path. Real-world brokers send
  // multipart with both text and html, so this rarely fires.
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
