import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import path from "path";
import { uploadDocument } from "@/lib/storage/documents";
import { isEmailFile, parseEmail, type AttachmentClassification } from "@/lib/ai/parse-email";

// ---------------------------------------------------------------------------
// Accepted Q88 / CP Recap formats. Real Q88s arrive as PDF or Word.
// .msg / .eml allowed for CP Recaps that come via email.
// ---------------------------------------------------------------------------
const ACCEPTED_EXT = new Set([".pdf", ".doc", ".docx", ".msg", ".eml"]);
const ACCEPTED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-outlook",
  "message/rfc822",
  "application/octet-stream", // some browsers send .msg / .eml as octet-stream
]);
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const VALID_FILE_TYPES = new Set(["q88", "cp_recap", "bl", "coa", "other"] as const);

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
        uploadedBy: schema.documents.uploadedBy,
        createdAt: schema.documents.createdAt,
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

      const [doc] = await db
        .insert(schema.documents)
        .values({
          tenantId,
          linkageId: id,
          filename: fileField.name,
          fileType: fileTypeField as "q88" | "cp_recap" | "bl" | "coa" | "other",
          storagePath,
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

      if (fileTypeField === "cp_recap" && isEmailFile(fileField.name)) {
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

      return NextResponse.json(
        { document: doc, autoImported },
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
        fileType: fileType as "q88" | "cp_recap" | "bl" | "coa" | "other",
        storagePath,
        uploadedBy: session.user.id,
      })
      .returning();

    return NextResponse.json({ document: doc }, { status: 201 });
  },
  { roles: ["operator", "admin"] }
);
