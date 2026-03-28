import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

// GET /api/notifications — lightweight badge count for header bell
export const GET = withAuth(async (_req, _ctx, session) => {
  const db = getDb();
  const tenantId = session.user.tenantId;

  // Active workflow instances
  const instances = await db
    .select({ id: schema.workflowInstances.id })
    .from(schema.workflowInstances)
    .where(
      and(
        eq(schema.workflowInstances.tenantId, tenantId),
        eq(schema.workflowInstances.status, "active")
      )
    );

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

  return NextResponse.json({
    pending: pending.length,
    renotify: renotify.length,
    total: pending.length + renotify.length,
  });
});
