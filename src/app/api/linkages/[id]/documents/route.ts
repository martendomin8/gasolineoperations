import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const createDocSchema = z.object({
  filename: z.string().min(1, "filename is required"),
  fileType: z.enum(["q88", "cp_recap", "bl", "coa", "other"]),
});

// GET /api/linkages/[id]/documents — list documents for a linkage
export const GET = withAuth(async (_req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
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
});

// POST /api/linkages/[id]/documents — attach a document to a linkage (e.g. Q88)
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

    const body = await req.json();
    const parseResult = createDocSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message ?? "Validation failed" },
        { status: 400 }
      );
    }

    const { filename, fileType } = parseResult.data;
    const storagePath = `/uploads/linkages/${id}/${filename}`;

    const [doc] = await db
      .insert(schema.documents)
      .values({
        tenantId,
        linkageId: id,
        filename,
        fileType,
        storagePath,
        uploadedBy: session.user.id,
      })
      .returning();

    return NextResponse.json({ document: doc }, { status: 201 });
  },
  { roles: ["operator", "admin"] }
);
