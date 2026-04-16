import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import path from "path";
import { extractQ88Text, parseQ88 } from "@/lib/ai/parse-q88";

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
    if (!doc.storagePath || !doc.storagePath.startsWith("/uploads/")) {
      return NextResponse.json({ error: "Document has no local file" }, { status: 400 });
    }

    // Resolve absolute path + load bytes
    const absolutePath = path.join(process.cwd(), "public", doc.storagePath);
    let buffer: Buffer;
    try {
      buffer = await readFile(absolutePath);
    } catch (err) {
      console.error("[parse-q88] readFile failed:", err);
      return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
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
