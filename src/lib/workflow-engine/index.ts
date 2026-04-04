import { eq, and, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { Deal, WorkflowTemplateStep } from "@/lib/db/schema";

// ============================================================
// TEMPLATE MATCHING
// ============================================================

/**
 * Score a template against a deal. Higher = better match.
 * Returns null if the template has no match on incoterm or direction.
 */
function scoreTemplate(template: schema.WorkflowTemplate, deal: Deal): number {
  let score = 0;

  if (template.incoterm && template.incoterm !== deal.incoterm) return -1;
  if (template.direction && template.direction !== deal.direction) return -1;

  if (template.incoterm === deal.incoterm) score += 3;
  if (template.direction === deal.direction) score += 2;

  if (template.regionPattern) {
    const patterns = template.regionPattern.split("|").map((p) => p.trim().toLowerCase());
    const loadportLower = deal.loadport.toLowerCase();
    if (patterns.some((p) => loadportLower.includes(p))) {
      score += 2;
    }
  }

  return score;
}

export async function matchTemplate(
  deal: Deal,
  db: Database
): Promise<schema.WorkflowTemplate | null> {
  const templates = await db
    .select()
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.tenantId, deal.tenantId));

  let best: schema.WorkflowTemplate | null = null;
  let bestScore = -1;

  for (const template of templates) {
    const score = scoreTemplate(template, deal);
    if (score > bestScore) {
      bestScore = score;
      best = template;
    }
  }

  return bestScore >= 0 ? best : null;
}

// ============================================================
// WORKFLOW INSTANTIATION
// ============================================================

export interface WorkflowStepWithDraft extends schema.WorkflowStep {
  blockedByStepName: string | null;
  recommendedAfterStepName: string | null;
  emailDraft: schema.EmailDraft | null;
  assignedPartyName: string | null;
  assignedPartyEmail: string | null;
}

// Terminal statuses — no further operator action needed on this step
const TERMINAL_STATUSES: ReadonlySet<schema.WorkflowStepStatus> = new Set([
  "sent",
  "acknowledged",
  "received",
  "done",
  "na",
  "cancelled",
]);

export function isTerminalStatus(status: schema.WorkflowStepStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface WorkflowInstanceDetail {
  instance: schema.WorkflowInstance;
  templateName: string;
  steps: WorkflowStepWithDraft[];
}

export async function instantiateWorkflow(
  deal: Deal,
  templateId: string,
  db: Database
): Promise<schema.WorkflowInstance> {
  const [template] = await db
    .select()
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, templateId));

  if (!template) throw new Error(`Template ${templateId} not found`);

  const steps = (template.steps ?? []) as WorkflowTemplateStep[];

  return await (db as any).transaction(async (tx: Database) => {
    // Create the workflow instance
    const [instance] = await tx
      .insert(schema.workflowInstances)
      .values({
        tenantId: deal.tenantId,
        dealId: deal.id,
        templateId: template.id,
        status: "active",
      })
      .returning();

    // First pass: create all steps as ready (soft dependencies, no hard blocks)
    const createdStepIds: Record<number, string> = {};

    for (const tStep of steps) {
      const [step] = await tx
        .insert(schema.workflowSteps)
        .values({
          tenantId: deal.tenantId,
          workflowInstanceId: instance.id,
          stepOrder: tStep.order,
          stepName: tStep.name,
          description: tStep.description ?? null,
          stepType: tStep.stepType,
          recipientPartyType: tStep.recipientPartyType,
          isExternalWait: tStep.isExternalWait ?? false,
          emailTemplateId: tStep.emailTemplateId ?? null,
          status: "ready", // all steps start ready — soft deps only
        })
        .returning();

      createdStepIds[tStep.order] = step.id;
    }

    // Second pass: set recommendedAfter (soft dependency reference)
    for (const tStep of steps) {
      const stepId = createdStepIds[tStep.order];
      // Support both the new recommendedAfterStep field and legacy blockedByStep
      const refOrder = tStep.recommendedAfterStep ?? tStep.blockedByStep ?? null;
      const recommendedAfterId =
        refOrder != null ? createdStepIds[refOrder] ?? null : null;

      if (recommendedAfterId) {
        await tx
          .update(schema.workflowSteps)
          .set({
            recommendedAfter: recommendedAfterId,
          })
          .where(eq(schema.workflowSteps.id, stepId));
      }
    }

    return instance;
  });
}

// ============================================================
// STEP ADVANCEMENT
// ============================================================

/**
 * Advance a workflow step to a new status.
 *
 * All steps use soft dependencies (recommendedAfter) — there is no
 * automatic unblocking. Operators can act on any ready step in any order.
 *
 * Terminal statuses: sent, acknowledged, received, done, na, cancelled.
 */
export async function advanceStep(
  stepId: string,
  newStatus: schema.WorkflowStepStatus,
  db: Database
): Promise<void> {
  const [step] = await db
    .select()
    .from(schema.workflowSteps)
    .where(eq(schema.workflowSteps.id, stepId));

  if (!step) throw new Error(`Step ${stepId} not found`);

  const updates: Partial<typeof schema.workflowSteps.$inferInsert> = {
    status: newStatus,
  };

  if (newStatus === "sent") {
    updates.sentAt = new Date();
  }

  await db.update(schema.workflowSteps).set(updates).where(eq(schema.workflowSteps.id, stepId));
}

// ============================================================
// DRAFT GENERATION
// ============================================================

/** Substitute {{merge_fields}} in a template string with deal values. */
export function renderTemplate(template: string, deal: Deal): string {
  const fields: Record<string, string> = {
    counterparty: deal.counterparty,
    direction: deal.direction,
    product: deal.product,
    quantity_mt: Number(deal.quantityMt).toLocaleString("en-US"),
    incoterm: deal.incoterm,
    loadport: deal.loadport,
    discharge_port: deal.dischargePort ?? "",
    laycan_start: deal.laycanStart,
    laycan_end: deal.laycanEnd,
    vessel_name: deal.vesselName ?? "[VESSEL TBC]",
    vessel_imo: deal.vesselImo ?? "[IMO TBC]",
    external_ref: deal.externalRef ?? "",
    pricing_formula: deal.pricingFormula ?? "",
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => fields[key] ?? `{{${key}}}`);
}

export async function generateDraft(
  step: schema.WorkflowStep,
  deal: Deal,
  db: Database
): Promise<schema.EmailDraft> {
  let emailTemplate: schema.EmailTemplate | null = null;

  if (step.emailTemplateId) {
    const [t] = await db
      .select()
      .from(schema.emailTemplates)
      .where(eq(schema.emailTemplates.id, step.emailTemplateId));
    emailTemplate = t ?? null;
  }

  // Auto-match: find best template by partyType + incoterm for this tenant
  if (!emailTemplate) {
    const candidates = await db
      .select()
      .from(schema.emailTemplates)
      .where(
        and(
          eq(schema.emailTemplates.tenantId, deal.tenantId),
          eq(schema.emailTemplates.partyType, step.recipientPartyType)
        )
      );

    // Prefer matching incoterm, fall back to any partyType match
    emailTemplate =
      candidates.find((c) => c.incoterm === deal.incoterm) ??
      candidates[0] ??
      null;
  }

  // Build subject + body — use template if found, otherwise generate a fallback
  let subject: string;
  let body: string;
  const mergeFieldsUsed: Record<string, string> = {};

  if (emailTemplate) {
    subject = renderTemplate(emailTemplate.subjectTemplate, deal);
    body = renderTemplate(emailTemplate.bodyTemplate, deal);
    const fieldMatches = emailTemplate.bodyTemplate.match(/\{\{(\w+)\}\}/g) ?? [];
    for (const match of fieldMatches) {
      const key = match.slice(2, -2);
      mergeFieldsUsed[key] = renderTemplate(match, deal);
    }
  } else {
    // Fallback: generic draft with all deal fields filled in
    subject = `${step.stepName} — ${deal.counterparty} / ${deal.product} / ${deal.laycanStart}`;
    body = [
      `Dear Sirs,`,
      ``,
      `Re: ${step.stepName}`,
      ``,
      `Counterparty: ${deal.counterparty}`,
      `Product: ${deal.product}`,
      `Quantity: ${Number(deal.quantityMt).toLocaleString("en-US")} MT`,
      `Incoterm: ${deal.incoterm}`,
      `Load Port: ${deal.loadport}`,
      `Discharge Port: ${deal.dischargePort}`,
      `Laycan: ${deal.laycanStart} – ${deal.laycanEnd}`,
      ...(deal.vesselName ? [`Vessel: ${deal.vesselName}${deal.vesselImo ? ` (IMO: ${deal.vesselImo})` : ""}`] : []),
      ...(deal.pricingFormula ? [`Pricing: ${deal.pricingFormula}`] : []),
      ...(deal.specialInstructions ? [``, `Special Instructions: ${deal.specialInstructions}`] : []),
      ``,
      `Please confirm receipt.`,
      ``,
      `Best regards`,
    ].join("\n");
    for (const key of ["counterparty", "product", "quantity_mt", "incoterm", "loadport", "discharge_port", "laycan_start", "laycan_end", "vessel_name"]) {
      mergeFieldsUsed[key] = key;
    }
  }

  // Look up assigned party's email if one is set
  let toAddresses = `[${step.recipientPartyType} contact — assign party]`;
  if (step.assignedPartyId) {
    const [party] = await db
      .select()
      .from(schema.parties)
      .where(eq(schema.parties.id, step.assignedPartyId));
    if (party?.email) {
      toAddresses = party.email;
    } else if (party) {
      toAddresses = `[${party.name} — no email on file]`;
    }
  }

  const [draft] = await db
    .insert(schema.emailDrafts)
    .values({
      workflowStepId: step.id,
      templateId: emailTemplate?.id ?? null,
      toAddresses,
      subject,
      body,
      mergeFieldsUsed,
      status: "draft",
    })
    .returning();

  // Link draft back to step
  await db
    .update(schema.workflowSteps)
    .set({ status: "draft_generated", emailDraftId: draft.id })
    .where(eq(schema.workflowSteps.id, step.id));

  return draft;
}

// ============================================================
// QUERY
// ============================================================

export async function getWorkflowForDeal(
  dealId: string,
  tenantId: string,
  db: Database
): Promise<WorkflowInstanceDetail | null> {
  const instances = await db
    .select()
    .from(schema.workflowInstances)
    .where(
      and(
        eq(schema.workflowInstances.dealId, dealId),
        eq(schema.workflowInstances.tenantId, tenantId)
      )
    );

  if (instances.length === 0) return null;

  const instance = instances[0];

  const [template] = await db
    .select()
    .from(schema.workflowTemplates)
    .where(eq(schema.workflowTemplates.id, instance.templateId));

  const steps = await db
    .select()
    .from(schema.workflowSteps)
    .where(eq(schema.workflowSteps.workflowInstanceId, instance.id))
    .orderBy(schema.workflowSteps.stepOrder);

  // Build a map of stepId → stepName for blockedBy labels
  const stepNameById: Record<string, string> = {};
  for (const s of steps) {
    stepNameById[s.id] = s.stepName;
  }

  // Fetch email drafts for steps that have them
  const draftIds = steps.map((s) => s.emailDraftId).filter((id): id is string => id != null);
  const drafts: schema.EmailDraft[] =
    draftIds.length > 0
      ? await db
          .select()
          .from(schema.emailDrafts)
          .where(inArray(schema.emailDrafts.id, draftIds))
      : [];

  const draftById: Record<string, schema.EmailDraft> = {};
  for (const d of drafts) {
    draftById[d.id] = d;
  }

  // Fetch assigned parties
  const partyIds = steps
    .map((s) => s.assignedPartyId)
    .filter((id): id is string => id != null);
  const assignedParties: schema.Party[] =
    partyIds.length > 0
      ? await db
          .select()
          .from(schema.parties)
          .where(inArray(schema.parties.id, partyIds))
      : [];

  const partyById: Record<string, schema.Party> = {};
  for (const p of assignedParties) {
    partyById[p.id] = p;
  }

  const enrichedSteps: WorkflowStepWithDraft[] = steps.map((s) => {
    const party = s.assignedPartyId ? (partyById[s.assignedPartyId] ?? null) : null;
    return {
      ...s,
      blockedByStepName: s.blockedBy ? (stepNameById[s.blockedBy] ?? null) : null,
      recommendedAfterStepName: s.recommendedAfter ? (stepNameById[s.recommendedAfter] ?? null) : null,
      emailDraft: s.emailDraftId ? (draftById[s.emailDraftId] ?? null) : null,
      assignedPartyName: party?.name ?? null,
      assignedPartyEmail: party?.email ?? null,
    };
  });

  return {
    instance,
    templateName: template?.name ?? "Unknown template",
    steps: enrichedSteps,
  };
}
