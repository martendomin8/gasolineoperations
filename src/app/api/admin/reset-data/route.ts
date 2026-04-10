import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import {
  deals,
  dealLegs,
  dealChangeLogs,
  auditLogs,
  workflowInstances,
  workflowSteps,
  emailDrafts,
  documents,
  linkages,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/admin/reset-data
 *
 * Admin-only endpoint to wipe all transactional data for the current tenant.
 * Preserves: tenant, users, parties, email templates, workflow templates.
 * Deletes: deals, linkages, workflow instances/steps, email drafts, audit logs,
 *          documents, deal legs, deal change logs.
 *
 * Used for clean-slate testing. Requires explicit confirmation in the request body.
 */
export const POST = withAuth(
  async (req, _ctx, session) => {
    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "WIPE_ALL_DATA") {
      return NextResponse.json(
        { error: "Missing confirmation. Send { confirm: 'WIPE_ALL_DATA' } to proceed." },
        { status: 400 }
      );
    }

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      const tenantId = session.user.tenantId;

      // Order matters due to foreign keys — delete children first
      const [emailDraftsDeleted] = await Promise.all([
        db.delete(emailDrafts).returning({ id: emailDrafts.id }),
      ]);
      const workflowStepsDeleted = await db.delete(workflowSteps).where(eq(workflowSteps.tenantId, tenantId)).returning({ id: workflowSteps.id });
      const workflowInstancesDeleted = await db.delete(workflowInstances).where(eq(workflowInstances.tenantId, tenantId)).returning({ id: workflowInstances.id });
      const documentsDeleted = await db.delete(documents).where(eq(documents.tenantId, tenantId)).returning({ id: documents.id });
      const dealLegsDeleted = await db.delete(dealLegs).where(eq(dealLegs.tenantId, tenantId)).returning({ id: dealLegs.id });
      const changeLogsDeleted = await db.delete(dealChangeLogs).where(eq(dealChangeLogs.tenantId, tenantId)).returning({ id: dealChangeLogs.id });
      const auditDeleted = await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId)).returning({ id: auditLogs.id });
      const dealsDeleted = await db.delete(deals).where(eq(deals.tenantId, tenantId)).returning({ id: deals.id });
      const linkagesDeleted = await db.delete(linkages).where(eq(linkages.tenantId, tenantId)).returning({ id: linkages.id });

      return {
        deals: dealsDeleted.length,
        linkages: linkagesDeleted.length,
        workflowInstances: workflowInstancesDeleted.length,
        workflowSteps: workflowStepsDeleted.length,
        emailDrafts: emailDraftsDeleted.length,
        documents: documentsDeleted.length,
        dealLegs: dealLegsDeleted.length,
        changeLogs: changeLogsDeleted.length,
        auditLogs: auditDeleted.length,
      };
    });

    return NextResponse.json({ ok: true, deleted: result });
  },
  { roles: ["admin"] }
);
