import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const updateDraftSchema = z.object({
  toAddresses: z.string().min(1).optional(),
  ccAddresses: z.string().optional(),
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

// GET /api/email-drafts/[id] — fetch a single draft
export const GET = withAuth(
  async (_req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { id } = await context.params;
    const db = getDb();

    const [draft] = await db
      .select()
      .from(schema.emailDrafts)
      .where(eq(schema.emailDrafts.id, id));

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    // Verify tenant access via the workflow step chain
    const [step] = await db
      .select()
      .from(schema.workflowSteps)
      .where(
        and(
          eq(schema.workflowSteps.id, draft.workflowStepId),
          eq(schema.workflowSteps.tenantId, session.user.tenantId)
        )
      );

    if (!step) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    return NextResponse.json({ draft });
  }
);

// PUT /api/email-drafts/[id] — update subject, body, to/cc addresses
export const PUT = withAuth(
  async (req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { id } = await context.params;
    const db = getDb();

    const body = await req.json();
    const parsed = updateDraftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }

    const [draft] = await db
      .select()
      .from(schema.emailDrafts)
      .where(eq(schema.emailDrafts.id, id));

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    // Verify tenant access
    const [step] = await db
      .select()
      .from(schema.workflowSteps)
      .where(
        and(
          eq(schema.workflowSteps.id, draft.workflowStepId),
          eq(schema.workflowSteps.tenantId, session.user.tenantId)
        )
      );

    if (!step) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    // Can only edit drafts that haven't been sent
    if (draft.status === "sent") {
      return NextResponse.json({ error: "Cannot edit a sent draft" }, { status: 422 });
    }

    const updates: Partial<typeof schema.emailDrafts.$inferInsert> = {};
    if (parsed.data.toAddresses !== undefined) updates.toAddresses = parsed.data.toAddresses;
    if (parsed.data.ccAddresses !== undefined) updates.ccAddresses = parsed.data.ccAddresses;
    if (parsed.data.subject !== undefined) updates.subject = parsed.data.subject;
    if (parsed.data.body !== undefined) updates.body = parsed.data.body;

    const [updated] = await db
      .update(schema.emailDrafts)
      .set(updates)
      .where(eq(schema.emailDrafts.id, id))
      .returning();

    // Audit log
    const [instance] = await db
      .select()
      .from(schema.workflowInstances)
      .where(eq(schema.workflowInstances.id, step.workflowInstanceId));

    if (instance) {
      await db.insert(schema.auditLogs).values({
        tenantId: session.user.tenantId,
        dealId: instance.dealId,
        userId: session.user.id,
        action: "email.draft_edited",
        details: { draftId: id, stepName: step.stepName, fields: Object.keys(updates) },
      });
    }

    return NextResponse.json({ draft: updated });
  },
  { roles: ["operator", "admin"] }
);
