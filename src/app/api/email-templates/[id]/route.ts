import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  partyType: z.enum(["terminal", "agent", "inspector", "broker"]).optional(),
  incoterm: z.enum(["FOB", "CIF", "CFR", "DAP", "FCA"]).nullable().optional(),
  region: z.string().max(100).nullable().optional(),
  subjectTemplate: z.string().min(1).optional(),
  bodyTemplate: z.string().min(1).optional(),
});

// GET /api/email-templates/[id]
export const GET = withAuth(
  async (_req: NextRequest, ctx: { params: Promise<Record<string, string>> }, session) => {
    const { id } = await ctx.params;
    const db = getDb();

    const [template] = await db
      .select()
      .from(schema.emailTemplates)
      .where(
        and(
          eq(schema.emailTemplates.id, id),
          eq(schema.emailTemplates.tenantId, session.user.tenantId)
        )
      );

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json(template);
  }
);

// PUT /api/email-templates/[id]
export const PUT = withAuth(
  async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }, session) => {
    const { id } = await ctx.params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }

    const db = getDb();
    const updates: Partial<typeof schema.emailTemplates.$inferInsert> = { ...parsed.data };

    // Re-extract merge fields if body template changed
    if (parsed.data.bodyTemplate) {
      const mergeFields = [...(parsed.data.bodyTemplate.match(/\{\{(\w+)\}\}/g) ?? [])]
        .map((m) => m.slice(2, -2));
      updates.mergeFields = [...new Set(mergeFields)];
    }

    updates.version = undefined; // will be incremented via SQL if needed

    const [updated] = await db
      .update(schema.emailTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(schema.emailTemplates.id, id),
          eq(schema.emailTemplates.tenantId, session.user.tenantId)
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  },
  { roles: ["admin"] }
);

// DELETE /api/email-templates/[id]
export const DELETE = withAuth(
  async (_req: NextRequest, ctx: { params: Promise<Record<string, string>> }, session) => {
    const { id } = await ctx.params;
    const db = getDb();

    const [deleted] = await db
      .delete(schema.emailTemplates)
      .where(
        and(
          eq(schema.emailTemplates.id, id),
          eq(schema.emailTemplates.tenantId, session.user.tenantId)
        )
      )
      .returning({ id: schema.emailTemplates.id });

    if (!deleted) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  },
  { roles: ["admin"] }
);
