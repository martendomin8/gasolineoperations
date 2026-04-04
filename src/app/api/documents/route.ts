import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// GET /api/documents?dealId=XXX — list documents for a deal
export const GET = withAuth(async (req: NextRequest, _ctx, session) => {
  const db = getDb();
  const tenantId = session.user.tenantId;
  const dealId = req.nextUrl.searchParams.get("dealId");

  if (!dealId) {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }

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
        eq(schema.documents.dealId, dealId)
      )
    )
    .orderBy(schema.documents.createdAt);

  return NextResponse.json({ documents: docs });
});

// POST /api/documents — create document metadata record
export const POST = withAuth(async (req: NextRequest, _ctx, session) => {
  const db = getDb();
  const tenantId = session.user.tenantId;
  const userId = session.user.id;

  // Accept JSON body with document metadata
  // In V1, we track metadata only — actual file storage is a V2 concern
  const body = await req.json();
  const { dealId, filename, fileType } = body as {
    dealId?: string;
    filename?: string;
    fileType?: string;
  };

  if (!dealId || !filename || !fileType) {
    return NextResponse.json(
      { error: "dealId, filename, and fileType are required" },
      { status: 400 }
    );
  }

  const validTypes = ["q88", "cp_recap", "bl", "coa", "other"];
  if (!validTypes.includes(fileType)) {
    return NextResponse.json(
      { error: `fileType must be one of: ${validTypes.join(", ")}` },
      { status: 400 }
    );
  }

  // Verify the deal belongs to this tenant
  const [deal] = await db
    .select({ id: schema.deals.id })
    .from(schema.deals)
    .where(
      and(
        eq(schema.deals.id, dealId),
        eq(schema.deals.tenantId, tenantId)
      )
    );

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // V1 placeholder path — actual file storage (S3, local disk) is V2
  const storagePath = `/uploads/${dealId}/${filename}`;

  const [doc] = await db
    .insert(schema.documents)
    .values({
      tenantId,
      dealId,
      filename,
      fileType,
      storagePath,
      uploadedBy: userId,
    })
    .returning();

  return NextResponse.json({ document: doc }, { status: 201 });
});
