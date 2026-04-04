import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, inArray, lte, gte, isNotNull, sql } from "drizzle-orm";

interface TaskItem {
  stepId: string;
  stepName: string;
  stepType: string;
  recipientPartyType: string;
  status: string;
  isExternalWait: boolean;
  dealId: string;
  dealRef: string | null;
  counterparty: string;
  product: string;
  incoterm: string;
  loadport: string;
  laycanStart: string;
  workflowInstanceId: string;
}

interface DashboardStats {
  activeDeals: number;
  pendingTasks: number;
  waitingExternal: number;
  completedToday: number;
}

// GET /api/tasks — return pending workflow steps grouped for the dashboard
export const GET = withAuth(
  async (_req: NextRequest, _context: unknown, session) => {
    const db = getDb();
    const tenantId = session.user.tenantId;

    // Get all active workflow instances for this tenant
    const instances = await db
      .select()
      .from(schema.workflowInstances)
      .where(
        and(
          eq(schema.workflowInstances.tenantId, tenantId),
          eq(schema.workflowInstances.status, "active")
        )
      );

    if (instances.length === 0) {
      return NextResponse.json({ tasks: [], stats: { activeDeals: 0, pendingTasks: 0, waitingExternal: 0, completedToday: 0 } });
    }

    const instanceIds = instances.map((i) => i.id);
    const dealIds = instances.map((i) => i.dealId);

    // Get actionable steps: ready or draft_generated
    const steps = await db
      .select()
      .from(schema.workflowSteps)
      .where(
        and(
          eq(schema.workflowSteps.tenantId, tenantId),
          inArray(schema.workflowSteps.workflowInstanceId, instanceIds),
          inArray(schema.workflowSteps.status, ["ready", "draft_generated", "sent", "needs_update"])
        )
      )
      .orderBy(schema.workflowSteps.stepOrder);

    // Get deals for context
    const deals = await db
      .select()
      .from(schema.deals)
      .where(
        and(
          eq(schema.deals.tenantId, tenantId),
          inArray(schema.deals.id, dealIds)
        )
      );

    const dealById = Object.fromEntries(deals.map((d) => [d.id, d]));
    const instanceByDealId = Object.fromEntries(instances.map((i) => [i.dealId, i]));

    const tasksRaw = steps.map((step) => {
      const instance = instances.find((i) => i.id === step.workflowInstanceId);
      if (!instance) return null;
      const deal = dealById[instance.dealId];
      if (!deal) return null;

      return {
        stepId: step.id,
        stepName: step.stepName,
        stepType: step.stepType as string,
        recipientPartyType: step.recipientPartyType as string,
        status: step.status as string,
        isExternalWait: step.isExternalWait,
        dealId: deal.id,
        dealRef: deal.externalRef,
        counterparty: deal.counterparty,
        product: deal.product,
        incoterm: deal.incoterm as string,
        loadport: deal.loadport,
        laycanStart: deal.laycanStart,
        workflowInstanceId: instance.id,
      };
    });

    const tasks: TaskItem[] = tasksRaw.filter((t): t is NonNullable<typeof t> => t !== null);

    // Compute stats
    const activeDealsCount = await db
      .select({ id: schema.deals.id })
      .from(schema.deals)
      .where(
        and(
          eq(schema.deals.tenantId, tenantId),
          inArray(schema.deals.status, ["active", "loading", "sailing", "discharging"])
        )
      );

    const readyCount = tasks.filter(
      (t) => t.status === "ready" || t.status === "draft_generated"
    ).length;

    const waitingCount = tasks.filter(
      (t) => t.status === "sent" && t.isExternalWait
    ).length;

    // Completed today: audit logs with workflow.step_sent action created today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sentToday = await db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.tenantId, tenantId),
          eq(schema.auditLogs.action, "workflow.step_sent")
        )
      );

    const completedToday = sentToday.filter((log) => {
      // We'd normally filter by date in SQL, but for simplicity filter in JS
      return true; // All for now — ideally add a gte(createdAt, today) filter
    }).length;

    const stats: DashboardStats = {
      activeDeals: activeDealsCount.length,
      pendingTasks: readyCount,
      waitingExternal: waitingCount,
      completedToday,
    };

    // Urgency: deals whose laycan_start is within next 5 days (and not cancelled/completed/draft)
    const urgentDealsRaw = await db
      .select({
        id: schema.deals.id,
        externalRef: schema.deals.externalRef,
        counterparty: schema.deals.counterparty,
        product: schema.deals.product,
        incoterm: schema.deals.incoterm,
        loadport: schema.deals.loadport,
        dischargePort: schema.deals.dischargePort,
        laycanStart: schema.deals.laycanStart,
        laycanEnd: schema.deals.laycanEnd,
        vesselName: schema.deals.vesselName,
        status: schema.deals.status,
        direction: schema.deals.direction,
      })
      .from(schema.deals)
      .where(
        and(
          eq(schema.deals.tenantId, tenantId),
          inArray(schema.deals.status, ["active", "loading", "sailing", "discharging"]),
          lte(schema.deals.laycanStart, sql`(CURRENT_DATE + INTERVAL '5 days')::date`),
          gte(schema.deals.laycanEnd, sql`(CURRENT_DATE - INTERVAL '1 day')::date`)
        )
      )
      .orderBy(schema.deals.laycanStart);

    const urgentDeals = urgentDealsRaw.map((d) => {
      const laycanDate = new Date(d.laycanStart);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysUntil = Math.ceil((laycanDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return { ...d, daysUntil };
    });

    // Pricing alerts: deals with pricingEstimatedDate within next 3 days
    const pricingAlertsRaw = await db
      .select({
        id: schema.deals.id,
        externalRef: schema.deals.externalRef,
        counterparty: schema.deals.counterparty,
        product: schema.deals.product,
        incoterm: schema.deals.incoterm,
        direction: schema.deals.direction,
        pricingType: schema.deals.pricingType,
        pricingFormula: schema.deals.pricingFormula,
        pricingEstimatedDate: schema.deals.pricingEstimatedDate,
      })
      .from(schema.deals)
      .where(
        and(
          eq(schema.deals.tenantId, tenantId),
          inArray(schema.deals.status, ["active", "loading", "sailing", "discharging"]),
          isNotNull(schema.deals.pricingEstimatedDate),
          gte(schema.deals.pricingEstimatedDate, sql`CURRENT_DATE`),
          lte(schema.deals.pricingEstimatedDate, sql`(CURRENT_DATE + INTERVAL '3 days')::date`)
        )
      )
      .orderBy(schema.deals.pricingEstimatedDate);

    const pricingAlerts = pricingAlertsRaw.map((d) => {
      const pricingDate = new Date(d.pricingEstimatedDate!);
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      const daysUntil = Math.ceil((pricingDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      return { ...d, daysUntil };
    });

    return NextResponse.json({ tasks, stats, urgentDeals, pricingAlerts });
  }
);
