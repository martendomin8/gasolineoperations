import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const createStepSchema = z.object({
  stepName: z.string().min(1).max(255),
  stepType: z.enum(["order", "appointment", "custom"]).default("custom"),
  recipientPartyType: z.string().max(50).nullable().optional(),
  description: z.string().nullable().optional(),
});

const updateStepSchema = z.object({
  stepId: z.string().uuid(),
  status: z.enum(["pending", "ready", "draft_generated", "sent", "done", "needs_update", "cancelled", "na"]).optional(),
  stepName: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
});

// GET /api/linkages/[id]/steps — list linkage-level workflow steps
export const GET = withAuth(async (_req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
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

  const steps = await db
    .select()
    .from(schema.linkageSteps)
    .where(and(eq(schema.linkageSteps.linkageId, id), eq(schema.linkageSteps.tenantId, tenantId)))
    .orderBy(schema.linkageSteps.stepOrder);

  return NextResponse.json({ steps });
});

// POST /api/linkages/[id]/steps — create a new linkage-level step
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
    const parseResult = createStepSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message ?? "Validation failed" },
        { status: 400 }
      );
    }

    // Get next step order
    const existing = await db
      .select({ stepOrder: schema.linkageSteps.stepOrder })
      .from(schema.linkageSteps)
      .where(eq(schema.linkageSteps.linkageId, id))
      .orderBy(schema.linkageSteps.stepOrder);

    const nextOrder = existing.length > 0 ? Math.max(...existing.map((s) => s.stepOrder)) + 1 : 1;

    const [step] = await db
      .insert(schema.linkageSteps)
      .values({
        tenantId,
        linkageId: id,
        stepName: parseResult.data.stepName,
        stepType: parseResult.data.stepType,
        recipientPartyType: parseResult.data.recipientPartyType ?? null,
        description: parseResult.data.description ?? null,
        stepOrder: nextOrder,
        status: "pending",
      })
      .returning();

    return NextResponse.json({ step }, { status: 201 });
  },
  { roles: ["operator", "admin"] }
);

// PUT /api/linkages/[id]/steps — update a linkage-level step
export const PUT = withAuth(
  async (req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { id } = await context.params;
    const db = getDb();
    const tenantId = session.user.tenantId;

    const body = await req.json();
    const parseResult = updateStepSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message ?? "Validation failed" },
        { status: 400 }
      );
    }

    const { stepId, ...updates } = parseResult.data;

    // Verify step belongs to this linkage and tenant
    const [existing] = await db
      .select()
      .from(schema.linkageSteps)
      .where(
        and(
          eq(schema.linkageSteps.id, stepId),
          eq(schema.linkageSteps.linkageId, id),
          eq(schema.linkageSteps.tenantId, tenantId)
        )
      );

    if (!existing) {
      return NextResponse.json({ error: "Step not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.stepName !== undefined) updateData.stepName = updates.stepName;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.status === "sent") updateData.sentAt = new Date();

    const [updated] = await db
      .update(schema.linkageSteps)
      .set(updateData)
      .where(eq(schema.linkageSteps.id, stepId))
      .returning();

    return NextResponse.json({ step: updated });
  },
  { roles: ["operator", "admin"] }
);
