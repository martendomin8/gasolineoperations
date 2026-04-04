import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { advanceStep, generateDraft } from "@/lib/workflow-engine";

// Valid step transitions by action
const STEP_ACTIONS = {
  generate_draft: { from: ["ready", "needs_update"], to: "draft_generated" as const },
  mark_sent: { from: ["ready", "draft_generated"], to: "sent" as const },
  mark_acknowledged: { from: ["sent"], to: "acknowledged" as const },
  mark_received: { from: ["sent", "acknowledged"], to: "received" as const },
  mark_done: { from: ["sent", "acknowledged", "received"], to: "done" as const },
  mark_cancelled: { from: ["pending", "blocked", "ready", "draft_generated", "sent", "acknowledged", "received", "needs_update"], to: "cancelled" as const },
  mark_na: { from: ["pending", "blocked", "ready", "draft_generated", "needs_update"], to: "na" as const },
  needs_update: { from: ["sent", "acknowledged"], to: "needs_update" as const },
  assign_party: { from: ["pending", "blocked", "ready", "draft_generated", "needs_update"], to: null as null },
} as const;

type StepAction = keyof typeof STEP_ACTIONS;

// PUT /api/workflows/steps/[stepId] — advance a workflow step
export const PUT = withAuth(
  async (req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { stepId } = await context.params;
    const db = getDb();

    const body = await req.json() as { action: StepAction };
    const { action } = body;

    if (!action || !STEP_ACTIONS[action]) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${Object.keys(STEP_ACTIONS).join(", ")}` },
        { status: 400 }
      );
    }

    // Fetch the step and verify tenant ownership via the instance → deal chain
    const [step] = await db
      .select()
      .from(schema.workflowSteps)
      .where(
        and(
          eq(schema.workflowSteps.id, stepId),
          eq(schema.workflowSteps.tenantId, session.user.tenantId)
        )
      );

    if (!step) {
      return NextResponse.json({ error: "Step not found" }, { status: 404 });
    }

    const { from, to } = STEP_ACTIONS[action];

    if (!(from as readonly string[]).includes(step.status)) {
      return NextResponse.json(
        {
          error: `Cannot perform action '${action}' on step with status '${step.status}'. Expected one of: ${from.join(", ")}`,
        },
        { status: 422 }
      );
    }

    // assign_party: update assigned party without changing status
    if (action === "assign_party") {
      const { partyId } = body as { action: StepAction; partyId: string | null };
      if (partyId !== undefined) {
        // Verify party belongs to tenant if set
        if (partyId) {
          const [party] = await db
            .select()
            .from(schema.parties)
            .where(
              and(
                eq(schema.parties.id, partyId),
                eq(schema.parties.tenantId, session.user.tenantId)
              )
            );
          if (!party) {
            return NextResponse.json({ error: "Party not found" }, { status: 404 });
          }
        }
        await db
          .update(schema.workflowSteps)
          .set({ assignedPartyId: partyId ?? null })
          .where(eq(schema.workflowSteps.id, stepId));

        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ error: "partyId is required" }, { status: 400 });
    }

    // For generate_draft, we create an EmailDraft first
    if (action === "generate_draft") {
      // Fetch the deal via the instance
      const [instance] = await db
        .select()
        .from(schema.workflowInstances)
        .where(eq(schema.workflowInstances.id, step.workflowInstanceId));

      if (!instance) {
        return NextResponse.json({ error: "Workflow instance not found" }, { status: 404 });
      }

      const [deal] = await db
        .select()
        .from(schema.deals)
        .where(eq(schema.deals.id, instance.dealId));

      if (!deal) {
        return NextResponse.json({ error: "Deal not found" }, { status: 404 });
      }

      try {
        const draft = await generateDraft(step, deal, db);

        // Audit log
        await db.insert(schema.auditLogs).values({
          tenantId: session.user.tenantId,
          dealId: deal.id,
          userId: session.user.id,
          action: "workflow.draft_generated",
          details: { stepId: step.id, stepName: step.stepName, draftId: draft.id },
        });

        return NextResponse.json({ success: true, draftId: draft.id });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to generate draft";
        return NextResponse.json({ error: message }, { status: 422 });
      }
    }

    // For all other actions, advance the step (to is non-null for all remaining actions)
    if (!to) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    await advanceStep(stepId, to, db);

    // If marking sent, update the email draft status (V1: operator already copied to Outlook)
    if (action === "mark_sent") {
      const [draft] = await db
        .select()
        .from(schema.emailDrafts)
        .where(eq(schema.emailDrafts.workflowStepId, stepId))
        .limit(1);

      if (draft) {
        await db
          .update(schema.emailDrafts)
          .set({
            status: "sent",
            sentViaSednaAt: new Date(),
          })
          .where(eq(schema.emailDrafts.id, draft.id));
      }
    }

    // Audit log
    const [instance] = await db
      .select()
      .from(schema.workflowInstances)
      .where(eq(schema.workflowInstances.id, step.workflowInstanceId));

    let workflowCompleted = false;

    if (instance) {
      await db.insert(schema.auditLogs).values({
        tenantId: session.user.tenantId,
        dealId: instance.dealId,
        userId: session.user.id,
        action: `workflow.step_${to}`,
        details: { stepId: step.id, stepName: step.stepName, action },
      });

      // Auto-complete: check if all steps in this instance are terminal
      const TERMINAL = new Set(["sent", "acknowledged", "received", "done", "cancelled", "na"]);
      if (to && TERMINAL.has(to)) {
        const allSteps = await db
          .select({ id: schema.workflowSteps.id, status: schema.workflowSteps.status })
          .from(schema.workflowSteps)
          .where(eq(schema.workflowSteps.workflowInstanceId, instance.id));

        const allDone = allSteps.every((s) =>
          s.id === stepId ? TERMINAL.has(to) : TERMINAL.has(s.status)
        );

        if (allDone && allSteps.length > 0) {
          await db
            .update(schema.workflowInstances)
            .set({ status: "completed" })
            .where(eq(schema.workflowInstances.id, instance.id));

          await db.insert(schema.auditLogs).values({
            tenantId: session.user.tenantId,
            dealId: instance.dealId,
            userId: session.user.id,
            action: "workflow.completed",
            details: { instanceId: instance.id },
          });

          workflowCompleted = true;
        }
      }
    }

    return NextResponse.json({ success: true, newStatus: to, workflowCompleted });
  },
  { roles: ["operator", "admin"] }
);
