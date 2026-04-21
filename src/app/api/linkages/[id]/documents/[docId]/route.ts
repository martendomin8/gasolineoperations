import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { deleteDocument } from "@/lib/storage/documents";

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
