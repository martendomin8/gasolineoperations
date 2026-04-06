import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, ne, inArray } from "drizzle-orm";
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
  mark_vessel_swap: { from: ["pending", "blocked", "ready", "draft_generated", "sent", "acknowledged", "received", "needs_update"], to: null as null },
} as const;

type StepAction = keyof typeof STEP_ACTIONS;

// PUT /api/workflows/steps/[stepId] — advance a workflow step
export const PUT = withAuth(
  async (req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { stepId } = await context.params;
    const db = getDb();

    const body = await req.json() as { action: StepAction; skippedPrerequisite?: string };
    const { action, skippedPrerequisite } = body;

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

    // mark_vessel_swap: update vessel on deal + cascade to linked deals
    if (action === "mark_vessel_swap") {
      const { newVesselName, newVesselImo } = body as {
        action: StepAction;
        newVesselName?: string;
        newVesselImo?: string;
      };

      if (!newVesselName) {
        return NextResponse.json({ error: "newVesselName is required" }, { status: 400 });
      }

      // Fetch the deal via the workflow instance
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

      // Collect all deal IDs to update (this deal + linked deals)
      const dealIdsToUpdate: string[] = [deal.id];

      if (deal.linkageCode) {
        const linkedDeals = await db
          .select({ id: schema.deals.id })
          .from(schema.deals)
          .where(
            and(
              eq(schema.deals.tenantId, session.user.tenantId),
              eq(schema.deals.linkageCode, deal.linkageCode),
              ne(schema.deals.id, deal.id)
            )
          );
        dealIdsToUpdate.push(...linkedDeals.map((d) => d.id));
      }

      // Update vessel fields on all deals
      for (const dealId of dealIdsToUpdate) {
        await db
          .update(schema.deals)
          .set({
            vesselName: newVesselName,
            vesselImo: newVesselImo ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.deals.id, dealId));

        // Record change log
        await db.insert(schema.dealChangeLogs).values({
          tenantId: session.user.tenantId,
          dealId,
          fieldChanged: "vesselName",
          oldValue: deal.vesselName ?? null,
          newValue: newVesselName,
          changedBy: session.user.id,
        });
        if (newVesselImo !== undefined) {
          await db.insert(schema.dealChangeLogs).values({
            tenantId: session.user.tenantId,
            dealId,
            fieldChanged: "vesselImo",
            oldValue: deal.vesselImo ?? null,
            newValue: newVesselImo ?? null,
            changedBy: session.user.id,
          });
        }
      }

      // Flag all sent/acknowledged steps across all affected deals as needs_update
      // (emails that used vessel_name or vessel_imo merge fields)
      let totalFlagged = 0;
      for (const dealId of dealIdsToUpdate) {
        const [inst] = await db
          .select()
          .from(schema.workflowInstances)
          .where(
            and(
              eq(schema.workflowInstances.dealId, dealId),
              eq(schema.workflowInstances.tenantId, session.user.tenantId)
            )
          );
        if (!inst) continue;

        const sentSteps = await db
          .select()
          .from(schema.workflowSteps)
          .where(
            and(
              eq(schema.workflowSteps.workflowInstanceId, inst.id),
              inArray(schema.workflowSteps.status, ["sent", "acknowledged"])
            )
          );

        const stepIdsWithDrafts = sentSteps
          .map((s) => s.emailDraftId)
          .filter((id): id is string => id != null);

        if (stepIdsWithDrafts.length > 0) {
          const draftsToCheck = await db
            .select()
            .from(schema.emailDrafts)
            .where(inArray(schema.emailDrafts.id, stepIdsWithDrafts));

          const affectedDraftIds = draftsToCheck
            .filter((d) => {
              const used = (d.mergeFieldsUsed ?? {}) as Record<string, string>;
              return "vessel_name" in used || "vessel_imo" in used;
            })
            .map((d) => d.id);

          if (affectedDraftIds.length > 0) {
            const affectedStepIds = sentSteps
              .filter((s) => s.emailDraftId && affectedDraftIds.includes(s.emailDraftId))
              .map((s) => s.id);

            if (affectedStepIds.length > 0) {
              await db
                .update(schema.workflowSteps)
                .set({ status: "needs_update" })
                .where(inArray(schema.workflowSteps.id, affectedStepIds));
              totalFlagged += affectedStepIds.length;
            }
          }
        }

        // Audit log per deal
        await db.insert(schema.auditLogs).values({
          tenantId: session.user.tenantId,
          dealId,
          userId: session.user.id,
          action: "workflow.vessel_swap",
          details: {
            newVesselName,
            newVesselImo: newVesselImo ?? null,
            oldVesselName: deal.vesselName,
            oldVesselImo: deal.vesselImo,
            triggeredFromDealId: deal.id,
          },
        });
      }

      return NextResponse.json({
        success: true,
        dealsUpdated: dealIdsToUpdate.length,
        stepsFlagged: totalFlagged,
      });
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

    // Cancel cascade: flag linked deal steps for review
    if (action === "mark_cancelled") {
      const [cancelInstance] = await db
        .select()
        .from(schema.workflowInstances)
        .where(eq(schema.workflowInstances.id, step.workflowInstanceId));

      if (cancelInstance) {
        const [cancelDeal] = await db
          .select()
          .from(schema.deals)
          .where(eq(schema.deals.id, cancelInstance.dealId));

        if (cancelDeal?.linkageCode) {
          // Find all linked deals with same linkageCode
          const linkedDeals = await db
            .select()
            .from(schema.deals)
            .where(
              and(
                eq(schema.deals.tenantId, session.user.tenantId),
                eq(schema.deals.linkageCode, cancelDeal.linkageCode),
                ne(schema.deals.id, cancelDeal.id)
              )
            );

          let cascadeFlagged = 0;
          for (const linkedDeal of linkedDeals) {
            const [linkedInstance] = await db
              .select()
              .from(schema.workflowInstances)
              .where(
                and(
                  eq(schema.workflowInstances.dealId, linkedDeal.id),
                  eq(schema.workflowInstances.tenantId, session.user.tenantId)
                )
              );
            if (!linkedInstance) continue;

            // Find sent steps on linked deal with same recipientPartyType
            const linkedSentSteps = await db
              .select()
              .from(schema.workflowSteps)
              .where(
                and(
                  eq(schema.workflowSteps.workflowInstanceId, linkedInstance.id),
                  eq(schema.workflowSteps.recipientPartyType, step.recipientPartyType),
                  inArray(schema.workflowSteps.status, ["sent"])
                )
              );

            if (linkedSentSteps.length > 0) {
              const linkedStepIds = linkedSentSteps.map((s) => s.id);
              await db
                .update(schema.workflowSteps)
                .set({ status: "needs_update" })
                .where(inArray(schema.workflowSteps.id, linkedStepIds));
              cascadeFlagged += linkedStepIds.length;

              // Audit log for each linked deal
              await db.insert(schema.auditLogs).values({
                tenantId: session.user.tenantId,
                dealId: linkedDeal.id,
                userId: session.user.id,
                action: "workflow.cancel_cascade_flagged",
                details: {
                  triggerDealId: cancelDeal.id,
                  triggerStepId: step.id,
                  triggerStepName: step.stepName,
                  partyType: step.recipientPartyType,
                  flaggedSteps: linkedStepIds.length,
                },
              });
            }
          }

          // Audit log on source deal about the cascade
          if (cascadeFlagged > 0) {
            await db.insert(schema.auditLogs).values({
              tenantId: session.user.tenantId,
              dealId: cancelDeal.id,
              userId: session.user.id,
              action: "workflow.cancel_cascade_triggered",
              details: {
                stepId: step.id,
                stepName: step.stepName,
                linkedDealsAffected: linkedDeals.length,
                totalStepsFlagged: cascadeFlagged,
              },
            });
          }
        }
      }
    }

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

      // --- Sync workflow step status → Excel excelStatuses JSONB ---
      const TERMINAL_EXCEL = new Set(["sent", "acknowledged", "done", "received"]);
      const REVERT_EXCEL = new Set(["ready", "pending"]);
      if (TERMINAL_EXCEL.has(to) || REVERT_EXCEL.has(to)) {
        // Determine the Excel field from step type/name
        const stepNameLower = step.stepName.toLowerCase();
        let excelField: string | null = null;
        if (step.stepType === "instruction" || stepNameLower.includes("doc")) {
          excelField = "docInstructions";
        } else if (step.stepType === "order" && stepNameLower.includes("voyage")) {
          excelField = "voyOrders";
        } else if (step.stepType === "order" && stepNameLower.includes("discharge")) {
          excelField = "disOrders";
        } else if (step.stepType === "nomination" && stepNameLower.includes("discharge")) {
          excelField = "dischargeNomination";
        } else if (step.stepType === "nomination") {
          excelField = "vesselNomination";
        } else if (step.stepType === "appointment") {
          excelField = "supervision";
        }

        if (excelField) {
          const [deal] = await db
            .select()
            .from(schema.deals)
            .where(eq(schema.deals.id, instance.dealId));

          if (deal) {
            const currentStatuses =
              ((deal as Record<string, unknown>).excelStatuses as Record<string, string | null> | null) ?? {};
            const updatedStatuses = {
              ...currentStatuses,
              [excelField]: TERMINAL_EXCEL.has(to) ? "Done" : null,
            };

            await db
              .update(schema.deals)
              .set({ excelStatuses: updatedStatuses, updatedAt: new Date() } as Record<string, unknown>)
              .where(eq(schema.deals.id, instance.dealId));
          }
        }
      }

      // Log when operator proceeds despite incomplete prerequisite
      if (skippedPrerequisite) {
        await db.insert(schema.auditLogs).values({
          tenantId: session.user.tenantId,
          dealId: instance.dealId,
          userId: session.user.id,
          action: "workflow.prerequisite_skipped",
          details: {
            stepId: step.id,
            stepName: step.stepName,
            skippedPrerequisite,
            actionTaken: action,
          },
        });
      }

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
