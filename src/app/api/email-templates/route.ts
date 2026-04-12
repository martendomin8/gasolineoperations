import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  partyType: z.enum(["terminal", "agent", "inspector", "broker"]),
  incoterm: z.enum(["FOB", "CIF", "CFR", "DAP"]).optional(),
  region: z.string().max(100).optional(),
  subjectTemplate: z.string().min(1),
  bodyTemplate: z.string().min(1),
  mergeFields: z.array(z.string()).optional(),
});

// GET /api/email-templates — list all templates for tenant
export const GET = withAuth(async (_req: NextRequest, _ctx: unknown, session) => {
  const db = getDb();
  const templates = await db
    .select()
    .from(schema.emailTemplates)
    .where(eq(schema.emailTemplates.tenantId, session.user.tenantId))
    .orderBy(schema.emailTemplates.name);

  const response = NextResponse.json({ templates });
  response.headers.set("Cache-Control", "private, max-age=120, stale-while-revalidate=600");
  return response;
});

// POST /api/email-templates — create new template
export const POST = withAuth(
  async (req: NextRequest, _ctx: unknown, session) => {
    const body = await req.json();
    const parsed = createTemplateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }

    // Auto-extract merge fields from body template if not provided
    const mergeFields =
      parsed.data.mergeFields ??
      [...(parsed.data.bodyTemplate.match(/\{\{(\w+)\}\}/g) ?? [])]
        .map((m) => m.slice(2, -2));

    const db = getDb();
    const [template] = await db
      .insert(schema.emailTemplates)
      .values({
        tenantId: session.user.tenantId,
        name: parsed.data.name,
        partyType: parsed.data.partyType,
        incoterm: parsed.data.incoterm,
        region: parsed.data.region,
        subjectTemplate: parsed.data.subjectTemplate,
        bodyTemplate: parsed.data.bodyTemplate,
        mergeFields: [...new Set(mergeFields)],
        createdBy: session.user.id,
      })
      .returning();

    return NextResponse.json(template, { status: 201 });
  },
  { roles: ["admin"] }
);
