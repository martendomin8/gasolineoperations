import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { DocumentFileType } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { deleteDocument } from "@/lib/storage/documents";

// Mirrors the DocumentFileType union in schema.ts. Kept inline to avoid
// importing the union as a runtime value (it's a type-only export).
const VALID_DOC_TYPES = new Set<DocumentFileType>([
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
]);

// PATCH /api/linkages/[id]/documents/[docId]
// Operator override: change a document's fileType when the AI classifier
// got it wrong. Only updates fileType (+ updatedAt); other fields are
// untouched. Tenant + linkage scoped.
export const PATCH = withAuth(
  async (req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { id, docId } = await context.params;
    const db = getDb();
    const tenantId = session.user.tenantId;
    const body = await req.json().catch(() => ({}));
    const newType = body?.fileType;

    if (!newType || !VALID_DOC_TYPES.has(newType)) {
      return NextResponse.json(
        { error: "fileType is required and must be one of the known doc types" },
        { status: 400 }
      );
    }

    const [doc] = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, docId),
          eq(schema.documents.linkageId, id),
          eq(schema.documents.tenantId, tenantId)
        )
      );
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const [updated] = await db
      .update(schema.documents)
      .set({ fileType: newType as DocumentFileType, updatedAt: new Date() })
      .where(eq(schema.documents.id, docId))
      .returning();

    return NextResponse.json({ document: updated });
  },
  { roles: ["operator", "admin"] }
);

// DELETE /api/linkages/[id]/documents/[docId]
// Removes the document row and attempts to unlink the file from disk.
// Tenant + linkage scoped. Disk errors are logged but do not fail the request —
// the DB row is the source of truth.
export const DELETE = withAuth(
  async (_req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { id, docId } = await context.params;
    const db = getDb();
    const tenantId = session.user.tenantId;

    const [doc] = await db
      .select({
        id: schema.documents.id,
        storagePath: schema.documents.storagePath,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, docId),
          eq(schema.documents.linkageId, id),
          eq(schema.documents.tenantId, tenantId)
        )
      );

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    await db.delete(schema.documents).where(eq(schema.documents.id, docId));

    if (doc.storagePath) {
      try {
        await deleteDocument(doc.storagePath);
      } catch (err) {
        console.warn("[documents DELETE] deleteDocument failed:", err);
      }
    }

    return NextResponse.json({ ok: true });
  },
  { roles: ["operator", "admin"] }
);
