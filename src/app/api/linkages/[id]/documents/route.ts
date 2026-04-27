import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { DocumentFileType } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import path from "path";
import { uploadDocument } from "@/lib/storage/documents";
import { isEmailFile, parseEmail, type AttachmentClassification } from "@/lib/ai/parse-email";
import { extractDocumentText } from "@/lib/ai/extract-document-text";
import { classifyDocument } from "@/lib/ai/classify-document";
import {
  extractCpRecapText,
  extractWarrantedSpeedFromText,
} from "@/lib/maritime/voyage-timeline/cp-speed";

// ---------------------------------------------------------------------------
// Accepted formats. Phase 0 = Q88 + CP recap (PDF/DOC/DOCX/MSG/EML). Phase 1
// widens to anything the chip-workflow drop zone accepts; the AI classifier
// detects the type so the operator no longer pre-labels every drop.
// ---------------------------------------------------------------------------
const ACCEPTED_EXT = new Set([".pdf", ".doc", ".docx", ".msg", ".eml", ".txt"]);
const ACCEPTED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-outlook",
  "message/rfc822",
  "text/plain",
  "application/octet-stream", // some browsers send .msg / .eml as octet-stream
]);
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

// Phase 1 widening of fileType. Includes "auto" which tells the upload
// route to run the AI classifier instead of trusting the form value.
const VALID_FILE_TYPES = new Set<DocumentFileType | "auto">([
  "auto",
  "q88",
  "cp_recap",
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
]);

function sanitiseFilename(name: string): string {
  // Strip path components, collapse whitespace, drop anything outside [A-Za-z0-9._-]
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "file";
  return base.replace(/\s+/g, "_").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 200) || "file";
}

// GET /api/linkages/[id]/documents — list documents for a linkage
export const GET = withAuth(
  async (_req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { id } = await context.params;
    const db = getDb();
    const tenantId = session.user.tenantId;

    const docs = await db
      .select({
        id: schema.documents.id,
        filename: schema.documents.filename,
        fileType: schema.documents.fileType,
        storagePath: schema.documents.storagePath,
        mimeType: schema.documents.mimeType,
        sizeBytes: schema.documents.sizeBytes,
        parsedData: schema.documents.parsedData,
        parserConfidence: schema.documents.parserConfidence,
        parserClassifierLabel: schema.documents.parserClassifierLabel,
        parserClassifierConfidence: schema.documents.parserClassifierConfidence,
        uploadedBy: schema.documents.uploadedBy,
        createdAt: schema.documents.createdAt,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.tenantId, tenantId),
          eq(schema.documents.linkageId, id)
        )
      )
      .orderBy(schema.documents.createdAt);

    return NextResponse.json({ documents: docs });
  }
);

// POST /api/linkages/[id]/documents — upload Q88 / CP Recap / other
//
// Expects multipart/form-data with fields:
//   - file:     the actual File (PDF / DOC / DOCX / MSG / EML)
//   - fileType: one of q88 | cp_recap | bl | coa | other
//
// The old JSON contract ({ filename, fileType }) is kept as a fallback for
// any legacy callers but the UI no longer uses it.
export const POST = withAuth(
  async (req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { id } = await context.params;
    const db = getDb();
    const tenantId = session.user.tenantId;

    // Verify linkage belongs to tenant
    const [linkage] = await db
      .select({ id: schema.linkages.id })
      .from(schema.linkages)
      .where(and(eq(schema.linkages.id, id), eq(schema.linkages.tenantId, tenantId)));

    if (!linkage) {
      return NextResponse.json({ error: "Linkage not found" }, { status: 404 });
    }

    const contentType = req.headers.get("content-type") || "";

    // --- Multipart upload path (the real drag-and-drop flow) ----------------
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const fileField = form.get("file");
      const fileTypeField = String(form.get("fileType") ?? "q88");

      if (!(fileField instanceof File)) {
        return NextResponse.json({ error: "file is required" }, { status: 400 });
      }
      if (!VALID_FILE_TYPES.has(fileTypeField as never)) {
        return NextResponse.json({ error: "invalid fileType" }, { status: 400 });
      }
      if (fileField.size === 0) {
        return NextResponse.json({ error: "empty file" }, { status: 400 });
      }
      if (fileField.size > MAX_BYTES) {
        return NextResponse.json({ error: "file too large (max 20MB)" }, { status: 400 });
      }

      const ext = path.extname(fileField.name).toLowerCase();
      if (!ACCEPTED_EXT.has(ext) && !ACCEPTED_MIME.has(fileField.type)) {
        return NextResponse.json(
          { error: "unsupported file type — accept PDF, DOC, DOCX, MSG, EML" },
          { status: 400 }
        );
      }

      const safeName = sanitiseFilename(fileField.name);
      const key = `linkages/${id}/${safeName}`;
      const buf = Buffer.from(await fileField.arrayBuffer());
      const storagePath = await uploadDocument(key, buf, fileField.type || undefined);

      // -------------------------------------------------------------------
      // AI auto-classification (Phase 1 chip-workflow drop zone).
      //
      // When the operator drops a file with fileType="auto" (or omits it),
      // run the classifier to pick a doc type. The operator confirms /
      // overrides in the confirm modal, so a wrong classification is never
      // silently destructive.
      //
      // Failures (no API key in dev, network error, etc.) fall back to
      // "other" with confidence 0 so the upload itself never fails just
      // because the AI side is down.
      // -------------------------------------------------------------------
      let finalFileType: DocumentFileType = (
        fileTypeField === "auto" ? "other" : (fileTypeField as DocumentFileType)
      );
      let classifierLabel: DocumentFileType | null = null;
      let classifierConfidence: number | null = null;

      if (fileTypeField === "auto") {
        try {
          const extracted = await extractDocumentText(buf, fileField.name, fileField.type || undefined);
          if (extracted.text.trim().length > 0) {
            const classification = await classifyDocument(extracted.text);
            finalFileType = classification.type;
            classifierLabel = classification.type;
            classifierConfidence = classification.confidence;
          }
        } catch (err) {
          console.warn(`[documents] auto-classify failed for ${fileField.name}:`, err);
          // finalFileType stays "other"; operator picks the right type in the modal.
        }
      }

      const [doc] = await db
        .insert(schema.documents)
        .values({
          tenantId,
          linkageId: id,
          filename: fileField.name,
          fileType: finalFileType,
          storagePath,
          mimeType: fileField.type || null,
          sizeBytes: fileField.size,
          parserClassifierLabel: classifierLabel,
          parserClassifierConfidence: classifierConfidence !== null ? String(classifierConfidence) : null,
          uploadedBy: session.user.id,
        })
        .returning();

      // -------------------------------------------------------------------
      // Email auto-extraction
      //
      // If the operator dropped a .eml as a CP Recap, the attachments inside
      // the email may include a Q88 (and/or BL/COA). We parse the email,
      // store each attachment as its own document with the classified
      // fileType, and return the list so the client can trigger downstream
      // parsing (parse-q88, etc.) on the auto-imported Q88(s).
      //
      // .msg (Outlook) is currently opaque; we store the file but don't try
      // to extract its parts. Adding .msg support requires a different
      // parser library and can be done later.
      // -------------------------------------------------------------------
      const autoImported: Array<{
        document: typeof doc;
        classification: AttachmentClassification;
      }> = [];

      if (finalFileType === "cp_recap" && isEmailFile(fileField.name)) {
        try {
          const parsed = await parseEmail(buf);

          for (const att of parsed.attachments) {
            // Skip attachments we can't classify into the Q88 / BL / COA /
            // CP Recap buckets — they go into the "other" pile, which we
            // still persist so the operator can see what arrived but don't
            // need to parse automatically.
            const childFileType = att.classification;

            const childSafe = sanitiseFilename(att.filename);
            const childKey = `linkages/${id}/${childSafe}`;
            const childPath = await uploadDocument(
              childKey,
              att.data,
              att.contentType || undefined
            );

            const [childDoc] = await db
              .insert(schema.documents)
              .values({
                tenantId,
                linkageId: id,
                filename: att.filename,
                fileType: childFileType,
                storagePath: childPath,
                uploadedBy: session.user.id,
              })
              .returning();

            autoImported.push({ document: childDoc, classification: childFileType });
          }
        } catch (err) {
          // Email parsing failed — log and continue. The .eml itself is
          // already stored as the cp_recap doc; the operator can manually
          // open it if needed.
          console.error(`[documents] email parse failed for linkage ${id}:`, err);
        }
      }

      // -------------------------------------------------------------------
      // CP speed auto-extraction (best-effort, never blocks the upload).
      //
      // When a CP recap lands, scan its text body for a WARRANTED SPEED /
      // FULL SERVICE SPEED clause and write to linkages.cp_speed_kn. This
      // populates the voyage-timeline cascade without the operator typing
      // the value manually. CP-clause source beats Q88; only writes when
      // the linkage doesn't already carry a manual override.
      // -------------------------------------------------------------------
      if (finalFileType === "cp_recap") {
        try {
          const recapText = await extractCpRecapText(buf, fileField.name);
          const speedKn = extractWarrantedSpeedFromText(recapText);
          if (speedKn !== null) {
            const [current] = await db
              .select({
                cpSpeedKn: schema.linkages.cpSpeedKn,
                cpSpeedSource: schema.linkages.cpSpeedSource,
              })
              .from(schema.linkages)
              .where(
                and(eq(schema.linkages.id, id), eq(schema.linkages.tenantId, tenantId))
              );
            // Don't clobber a manual operator override.
            if (!current || current.cpSpeedSource !== "manual") {
              await db
                .update(schema.linkages)
                .set({
                  cpSpeedKn: String(speedKn),
                  cpSpeedSource: "cp_clause",
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(schema.linkages.id, id),
                    eq(schema.linkages.tenantId, tenantId)
                  )
                );
            }
          }
        } catch (err) {
          // Speed extraction failures must never block the upload — the
          // document itself is already stored, and the operator can still
          // type the speed manually.
          console.error(
            `[documents] CP speed extraction failed for linkage ${id}:`,
            err
          );
        }
      }

      return NextResponse.json(
        {
          document: doc,
          autoImported,
          classification:
            classifierLabel !== null
              ? { type: classifierLabel, confidence: classifierConfidence }
              : null,
        },
        { status: 201 }
      );
    }

    // --- Legacy JSON path (filename only, no real bytes) --------------------
    // Kept for any stale callers; deprecate once audited.
    const body = await req.json();
    const filename = typeof body?.filename === "string" ? body.filename : null;
    const fileType = typeof body?.fileType === "string" ? body.fileType : null;
    if (!filename || !fileType || !VALID_FILE_TYPES.has(fileType as never)) {
      return NextResponse.json({ error: "filename and valid fileType are required" }, { status: 400 });
    }

    const storagePath = `/uploads/linkages/${id}/${sanitiseFilename(filename)}`;
    const [doc] = await db
      .insert(schema.documents)
      .values({
        tenantId,
        linkageId: id,
        filename,
        fileType: fileType as DocumentFileType,
        storagePath,
        uploadedBy: session.user.id,
      })
      .returning();

    return NextResponse.json({ document: doc }, { status: 201 });
  },
  { roles: ["operator", "admin"] }
);
