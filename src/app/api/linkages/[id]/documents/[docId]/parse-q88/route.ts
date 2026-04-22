import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import path from "path";
import { extractQ88Text, parseQ88 } from "@/lib/ai/parse-q88";
import { hasReadableFile, readDocument } from "@/lib/storage/documents";

// POST /api/linkages/[id]/documents/[docId]/parse-q88
// Reads the uploaded Q88 from disk, extracts text, and sends it to the AI
// provider for structured extraction. Returns the parsed result — does NOT
// persist it. The frontend shows a confirm modal; the operator then calls
// PUT /api/linkages/[id] with the fields they accept.
export const POST = withAuth(
  async (_req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { id, docId } = await context.params;
    const db = getDb();
    const tenantId = session.user.tenantId;

    const [doc] = await db
      .select()
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
    if (doc.fileType !== "q88") {
      return NextResponse.json({ error: "Document is not a Q88" }, { status: 400 });
    }
    if (!hasReadableFile(doc.storagePath)) {
      return NextResponse.json({ error: "Document has no readable file" }, { status: 400 });
    }

    let buffer: Buffer;
    try {
      buffer = await readDocument(doc.storagePath!);
    } catch (err) {
      console.error("[parse-q88] readDocument failed:", err);
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const extension = path.extname(doc.filename).toLowerCase();
    let text = "";
    try {
      text = await extractQ88Text(buffer, extension);
    } catch (err) {
      console.error("[parse-q88] extractQ88Text threw:", err);
      return NextResponse.json(
        {
          error: `Text extraction failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 500 }
      );
    }

    if (!text || text.trim().length < 100) {
      return NextResponse.json(
        {
          error:
            "Could not extract text from Q88 (scanned PDF or unsupported format?). " +
            `Got ${text.length} chars.`,
        },
        { status: 400 }
      );
    }

    try {
      const result = await parseQ88(text);
      // Stamp provenance — the frontend can include these if the operator accepts.
      const particulars = {
        ...result.particulars,
        parsedAt: new Date().toISOString(),
        sourceDocumentId: doc.id,
      };
      return NextResponse.json({
        vesselName: result.vesselName,
        vesselImo: result.vesselImo,
        vesselMmsi: result.vesselMmsi,
        particulars,
        confidenceScores: result.confidenceScores,
      });
    } catch (err) {
      console.error("[parse-q88] AI parse failed:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "AI parse failed" },
        { status: 500 }
      );
    }
  },
  { roles: ["operator", "admin"] }
);
