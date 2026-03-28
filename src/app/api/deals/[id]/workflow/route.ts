import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  matchTemplate,
  instantiateWorkflow,
  getWorkflowForDeal,
} from "@/lib/workflow-engine";

// GET /api/deals/[id]/workflow — return current workflow state for the deal
export const GET = withAuth(
  async (_req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { id } = await context.params;
    const db = getDb();

    // Verify the deal belongs to this tenant
    const [deal] = await db
      .select()
      .from(schema.deals)
      .where(
        and(eq(schema.deals.id, id), eq(schema.deals.tenantId, session.user.tenantId))
      );

    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const workflow = await getWorkflowForDeal(id, session.user.tenantId, db);

    if (!workflow) {
      return NextResponse.json({ workflow: null, matchedTemplate: null });
    }

    return NextResponse.json({ workflow });
  }
);

// POST /api/deals/[id]/workflow — instantiate workflow for the deal
export const POST = withAuth(
  async (_req: NextRequest, context: { params: Promise<Record<string, string>> }, session) => {
    const { id } = await context.params;
    const db = getDb();

    const [deal] = await db
      .select()
      .from(schema.deals)
      .where(
        and(eq(schema.deals.id, id), eq(schema.deals.tenantId, session.user.tenantId))
      );

    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Check if a workflow already exists
    const existing = await getWorkflowForDeal(id, session.user.tenantId, db);
    if (existing) {
      return NextResponse.json(
        { error: "Workflow already exists for this deal" },
        { status: 409 }
      );
    }

    // Match a template
    const template = await matchTemplate(deal, db);
    if (!template) {
      return NextResponse.json(
        { error: "No matching workflow template found for this deal" },
        { status: 422 }
      );
    }

    const instance = await instantiateWorkflow(deal, template.id, db);

    // Log in audit
    await db.insert(schema.auditLogs).values({
      tenantId: session.user.tenantId,
      dealId: deal.id,
      userId: session.user.id,
      action: "workflow.instantiated",
      details: { templateId: template.id, templateName: template.name },
    });

    const workflow = await getWorkflowForDeal(id, session.user.tenantId, db);
    return NextResponse.json({ workflow }, { status: 201 });
  },
  { roles: ["operator", "admin"] }
);
