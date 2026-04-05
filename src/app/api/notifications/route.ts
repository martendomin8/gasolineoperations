import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, inArray, notInArray, isNotNull, lte, gte, sql } from "drizzle-orm";

// GET /api/notifications — lightweight badge count for header bell
export const GET = withAuth(async (_req, _ctx, session) => {
  const db = getDb();
  const tenantId = session.user.tenantId;

  // Exclude completed/cancelled deals — get their IDs
  const excludedDeals = await db
    .select({ id: schema.deals.id })
    .from(schema.deals)
    .where(
      and(
        eq(schema.deals.tenantId, tenantId),
        inArray(schema.deals.status, ["completed", "cancelled"])
      )
    );
  const excludedDealIds = excludedDeals.map((d) => d.id);

  // Active workflow instances (excluding those for completed/cancelled deals)
  const instanceQuery = db
    .select({ id: schema.workflowInstances.id })
    .from(schema.workflowInstances)
    .where(
      and(
        eq(schema.workflowInstances.tenantId, tenantId),
        eq(schema.workflowInstances.status, "active"),
        ...(excludedDealIds.length > 0
          ? [notInArray(schema.workflowInstances.dealId, excludedDealIds)]
          : [])
      )
    );
  const instances = await instanceQuery;

  if (instances.length === 0) {
    return NextResponse.json({ pending: 0, renotify: 0, total: 0 });
  }

  const instanceIds = instances.map((i) => i.id);

  // Count ready/draft_generated steps (actionable)
  const pending = await db
    .select({ id: schema.workflowSteps.id })
    .from(schema.workflowSteps)
    .where(
      and(
        eq(schema.workflowSteps.tenantId, tenantId),
        inArray(schema.workflowSteps.workflowInstanceId, instanceIds),
        inArray(schema.workflowSteps.status, ["ready", "draft_generated"])
      )
    );

  // Count needs_update steps (re-notification required)
  const renotify = await db
    .select({ id: schema.workflowSteps.id })
    .from(schema.workflowSteps)
    .where(
      and(
        eq(schema.workflowSteps.tenantId, tenantId),
        inArray(schema.workflowSteps.workflowInstanceId, instanceIds),
        eq(schema.workflowSteps.status, "needs_update")
      )
    );

  // Count deals with pricing dates within 3 days
  const pricingAlerts = await db
    .select({ id: schema.deals.id })
    .from(schema.deals)
    .where(
      and(
        eq(schema.deals.tenantId, tenantId),
        inArray(schema.deals.status, ["active", "loading", "sailing", "discharging"]),
        isNotNull(schema.deals.pricingEstimatedDate),
        gte(schema.deals.pricingEstimatedDate, sql`CURRENT_DATE`),
        lte(schema.deals.pricingEstimatedDate, sql`(CURRENT_DATE + INTERVAL '3 days')::date`)
      )
    );

  const response = NextResponse.json({
    pending: pending.length,
    renotify: renotify.length,
    pricingAlerts: pricingAlerts.length,
    total: pending.length + renotify.length + pricingAlerts.length,
  });
  response.headers.set("Cache-Control", "private, max-age=10, stale-while-revalidate=30");
  return response;
});
