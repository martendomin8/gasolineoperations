import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import path from "path";
import { hasReadableFile, readDocument } from "@/lib/storage/documents";
import { extractQ88Text } from "@/lib/ai/parse-q88";
import { isEmailFile, parseEmail } from "@/lib/ai/parse-email";
import {
  BASE_FORMS,
  answerCpQuestion,
  detectBaseForm,
  loadBaseFormReference,
} from "@/lib/ai/cp-qa";

// POST /api/linkages/[id]/cp-qa
//
// Body: { question: string, baseForm?: string }
//
// Reads the most recent CP recap document for the linkage, extracts its
// text (handles .eml / .pdf / .docx / .txt), detects the base charter
// form named in the recap, layers the matching base-form reference doc
// underneath, and asks Claude to answer the operator's question with a
// citation. Returns:
//   { answer, baseFormDetected, baseFormUsed, recapDocId }

interface CpQaRequestBody {
  question?: unknown;
  baseForm?: unknown;
}

async function extractRecapText(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".txt") {
    return buffer.toString("utf8");
  }
  if (isEmailFile(filename)) {
    const parsed = await parseEmail(buffer);
    return parsed.bodyText ?? "";
  }
  if (ext === ".pdf" || ext === ".doc" || ext === ".docx") {
    return extractQ88Text(buffer, ext);
  }
  // Fallback — attempt plain UTF-8 read
  return buffer.toString("utf8");
}

export const POST = withAuth(
  async (req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { id } = await context.params;
    const db = getDb();
    const tenantId = session.user.tenantId;

    // Verify linkage belongs to tenant
    const [linkage] = await db
      .select({ id: schema.linkages.id, vesselName: schema.linkages.vesselName })
      .from(schema.linkages)
      .where(and(eq(schema.linkages.id, id), eq(schema.linkages.tenantId, tenantId)));

    if (!linkage) {
      return NextResponse.json({ error: "Linkage not found" }, { status: 404 });
    }

    // Parse request
    let body: CpQaRequestBody;
    try {
      body = (await req.json()) as CpQaRequestBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const explicitBaseForm =
      typeof body.baseForm === "string" && body.baseForm.length > 0
        ? body.baseForm
        : null;

    if (!question || question.length < 3) {
      return NextResponse.json(
        { error: "Question is required (min 3 chars)" },
        { status: 400 }
      );
    }
    if (question.length > 2000) {
      return NextResponse.json(
        { error: "Question too long (max 2000 chars)" },
        { status: 400 }
      );
    }

    // Load the most recent CP recap document for this linkage. The
    // operator may have dropped multiple recaps over time (e.g. an
    // updated recap superseding the first); the latest one is the
    // contractually current state.
    const recapDocs = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.tenantId, tenantId),
          eq(schema.documents.linkageId, id),
          eq(schema.documents.fileType, "cp_recap")
        )
      )
      .orderBy(desc(schema.documents.createdAt))
      .limit(1);

    const recapDoc = recapDocs[0] ?? null;
    if (!recapDoc) {
      return NextResponse.json(
        {
          error:
            "No CP recap uploaded yet for this linkage. Drop the recap (.eml / .pdf / .docx / .txt) into the CP Recap zone before asking questions.",
        },
        { status: 400 }
      );
    }
    if (!hasReadableFile(recapDoc.storagePath)) {
      return NextResponse.json(
        { error: "Recap document has no readable file on disk" },
        { status: 500 }
      );
    }

    // Read + extract recap text
    let recapBuffer: Buffer;
    try {
      recapBuffer = await readDocument(recapDoc.storagePath!);
    } catch (err) {
      console.error("[cp-qa] readDocument failed:", err);
      return NextResponse.json(
        { error: "Failed to read recap from storage" },
        { status: 500 }
      );
    }

    let recapText = "";
    try {
      recapText = await extractRecapText(recapBuffer, recapDoc.filename);
    } catch (err) {
      console.error("[cp-qa] extractRecapText threw:", err);
      return NextResponse.json(
        {
          error: `Recap text extraction failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 500 }
      );
    }
    if (!recapText || recapText.trim().length < 50) {
      return NextResponse.json(
        {
          error:
            "Could not extract meaningful text from the recap. If this is a scanned PDF you may need to OCR it first.",
        },
        { status: 400 }
      );
    }

    // Resolve which base form to use. Operator override wins; otherwise
    // detect from the recap's TITLE block.
    let baseFormSpec: ReturnType<typeof detectBaseForm> = null;
    if (explicitBaseForm) {
      baseFormSpec =
        BASE_FORMS.find(
          (f) => f.key.toLowerCase() === explicitBaseForm.toLowerCase()
        ) ?? null;
    }
    if (!baseFormSpec) {
      baseFormSpec = detectBaseForm(recapText);
    }

    let baseReference: string | null = null;
    if (baseFormSpec) {
      try {
        baseReference = await loadBaseFormReference(baseFormSpec);
      } catch (err) {
        console.warn("[cp-qa] loadBaseFormReference failed:", err);
      }
    }

    // Run the AI Q&A
    try {
      const result = await answerCpQuestion({
        question,
        recapText,
        baseFormReference: baseReference,
        baseFormName: baseFormSpec?.fullName ?? null,
      });
      return NextResponse.json({
        answer: result.answer,
        baseFormDetected: baseFormSpec?.key ?? null,
        baseFormUsed: baseReference && baseFormSpec ? baseFormSpec.key : null,
        baseFormReady: Boolean(baseReference),
        recapDocId: recapDoc.id,
        recapFilename: recapDoc.filename,
      });
    } catch (err) {
      console.error("[cp-qa] AI call failed:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "AI call failed" },
        { status: 500 }
      );
    }
  },
  { roles: ["operator", "admin"] }
);
