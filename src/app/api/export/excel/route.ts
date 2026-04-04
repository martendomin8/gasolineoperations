import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import {
  deals,
  users,
  workflowInstances,
  workflowSteps,
} from "@/lib/db/schema";
import { eq, and, ne, notInArray } from "drizzle-orm";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Column headers matching the GASOLINE VESSELS LIST 2026.xlsx format
// ---------------------------------------------------------------------------

const EXCEL_HEADERS = [
  "LAYCAN",
  "Counterparty",
  "Vessel",
  "Linkage",
  "Reference",
  "OPS",
  "PRICING",
  "B/L FIGURES",
  "DOC INSTRUCTIONS",
  "VOY/DIS ORDERS",
  "",
  "VESSEL NOMINATION",
  "SUPERVISION (LP/DP)",
  "",
  "COA to Traders",
  "Discharge Nomination(our terminal)",
  "Outturn",
  "Freight invoice",
  "TAX",
  "INVOICE TO CP",
];

// Operator-managed columns that we must NEVER overwrite
const OPERATOR_MANAGED_COLS = new Set([
  "COA to Traders",
  "Outturn",
  "Freight invoice",
  "INVOICE TO CP",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format laycan dates to "DD-DD MMM" range, e.g. "10-15 APR" */
function formatLaycanRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const months = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ];
  const sDay = s.getUTCDate();
  const eDay = e.getUTCDate();
  const month = months[e.getUTCMonth()];
  return `${sDay}-${eDay} ${month}`;
}

/** Build the LAYCAN cell, e.g. "P(FOB ALIAGA 10-15 APR)" */
function formatLaycanCell(
  direction: string,
  incoterm: string,
  loadport: string,
  laycanStart: string,
  laycanEnd: string,
): string {
  const prefix = direction === "buy" ? "P" : "S";
  const range = formatLaycanRange(laycanStart, laycanEnd);
  return `${prefix}(${incoterm} ${loadport.toUpperCase()} ${range})`;
}

/** Map workflow step status to Excel display value */
function stepStatusToExcel(status: string | null): string {
  switch (status) {
    case "sent":
    case "acknowledged":
    case "done":
      return "DONE";
    case "draft_generated":
      return "DRAFT";
    case "needs_update":
      return "UPDATE";
    case "cancelled":
      return "CANCELLED";
    case "received":
      return "RECEIVED";
    default:
      return "";
  }
}

/** Build operator initials from two operator names, e.g. "AT/KK" */
function operatorInitials(primary?: string | null, secondary?: string | null): string {
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
  const parts: string[] = [];
  if (primary) parts.push(initials(primary));
  if (secondary) parts.push(initials(secondary));
  return parts.join("/");
}

/** Determine TAX value based on region/port heuristics */
function taxValue(loadport: string, dischargePort: string | null): string {
  // EU ports generally use T2 (free circulation), non-EU use T1
  const euPorts = [
    "amsterdam", "antwerp", "rotterdam", "klaipeda",
    "hamburg", "marseille", "genoa", "bilbao",
  ];
  const port = (dischargePort ?? loadport).toLowerCase();
  const isEu = euPorts.some((p) => port.includes(p));
  return isEu ? "T2" : "T1";
}

/** Format pricing, e.g. "BL 0-0-5" */
function formatPricing(
  pricingType: string | null,
  pricingFormula: string | null,
): string {
  if (!pricingType && !pricingFormula) return "";
  const parts: string[] = [];
  if (pricingType) parts.push(pricingType.toUpperCase());
  if (pricingFormula) parts.push(pricingFormula);
  return parts.join(" ");
}

/** Format B/L figures, e.g. "37000MT +/-10%" */
function formatBlFigures(
  contractedQty: string | null,
  quantityMt: string,
  nominatedQty: string | null,
): string {
  // If there's a contracted qty with tolerance text, prefer that
  if (contractedQty) return contractedQty;
  // Otherwise fall back to raw quantity
  const qty = nominatedQty ?? quantityMt;
  return `${Number(qty).toLocaleString("en-US", { maximumFractionDigits: 0 })}MT`;
}

// ---------------------------------------------------------------------------
// Find the best-matching workflow step status for a given category
// ---------------------------------------------------------------------------

type StepCategory = "doc" | "order" | "nomination" | "appointment";

function findStepStatus(
  steps: { stepType: string; stepName: string; status: string }[],
  category: StepCategory,
): string {
  if (steps.length === 0) return "";

  let match: typeof steps[number] | undefined;
  switch (category) {
    case "doc":
      match = steps.find(
        (s) =>
          s.stepType === "instruction" ||
          s.stepName.toLowerCase().includes("doc"),
      );
      break;
    case "order":
      match = steps.find(
        (s) =>
          s.stepType === "order" ||
          s.stepName.toLowerCase().includes("order"),
      );
      break;
    case "nomination":
      match = steps.find(
        (s) =>
          s.stepType === "nomination" &&
          !s.stepName.toLowerCase().includes("discharge"),
      );
      break;
    case "appointment":
      match = steps.find(
        (s) =>
          s.stepType === "appointment" ||
          s.stepName.toLowerCase().includes("inspector") ||
          s.stepName.toLowerCase().includes("supervision"),
      );
      break;
  }

  return stepStatusToExcel(match?.status ?? null);
}

// ---------------------------------------------------------------------------
// POST /api/export/excel
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (_req, _ctx, session) => {
    const tenantId = session.user.tenantId;

    const data = await withTenantDb(tenantId, async (db) => {
      // 1. Fetch all non-draft, non-cancelled deals
      const allDeals = await db
        .select({
          id: deals.id,
          externalRef: deals.externalRef,
          linkageCode: deals.linkageCode,
          counterparty: deals.counterparty,
          direction: deals.direction,
          product: deals.product,
          quantityMt: deals.quantityMt,
          contractedQty: deals.contractedQty,
          nominatedQty: deals.nominatedQty,
          incoterm: deals.incoterm,
          loadport: deals.loadport,
          dischargePort: deals.dischargePort,
          laycanStart: deals.laycanStart,
          laycanEnd: deals.laycanEnd,
          vesselName: deals.vesselName,
          status: deals.status,
          pricingType: deals.pricingType,
          pricingFormula: deals.pricingFormula,
          assignedOperatorId: deals.assignedOperatorId,
          secondaryOperatorId: deals.secondaryOperatorId,
        })
        .from(deals)
        .where(
          and(
            eq(deals.tenantId, tenantId),
            ne(deals.status, "draft"),
          ),
        );

      // 2. Collect operator IDs to look up names
      const operatorIds = new Set<string>();
      for (const d of allDeals) {
        if (d.assignedOperatorId) operatorIds.add(d.assignedOperatorId);
        if (d.secondaryOperatorId) operatorIds.add(d.secondaryOperatorId);
      }
      const operatorMap = new Map<string, string>();
      if (operatorIds.size > 0) {
        const ops = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.tenantId, tenantId));
        for (const op of ops) {
          operatorMap.set(op.id, op.name);
        }
      }

      // 3. Fetch workflow steps for each deal (via workflow instances)
      const dealStepsMap = new Map<
        string,
        { stepType: string; stepName: string; status: string }[]
      >();

      const instances = await db
        .select({
          id: workflowInstances.id,
          dealId: workflowInstances.dealId,
        })
        .from(workflowInstances)
        .where(eq(workflowInstances.tenantId, tenantId));

      if (instances.length > 0) {
        const instanceDealMap = new Map<string, string>();
        for (const inst of instances) {
          instanceDealMap.set(inst.id, inst.dealId);
        }

        const allSteps = await db
          .select({
            workflowInstanceId: workflowSteps.workflowInstanceId,
            stepType: workflowSteps.stepType,
            stepName: workflowSteps.stepName,
            status: workflowSteps.status,
          })
          .from(workflowSteps)
          .where(eq(workflowSteps.tenantId, tenantId));

        for (const step of allSteps) {
          const dealId = instanceDealMap.get(step.workflowInstanceId);
          if (!dealId) continue;
          if (!dealStepsMap.has(dealId)) dealStepsMap.set(dealId, []);
          dealStepsMap.get(dealId)!.push({
            stepType: step.stepType,
            stepName: step.stepName,
            status: step.status,
          });
        }
      }

      return { allDeals, operatorMap, dealStepsMap };
    });

    const { allDeals, operatorMap, dealStepsMap } = data;

    // Split into active (ONGOING) and completed
    const ongoing = allDeals.filter((d) => d.status !== "completed" && d.status !== "cancelled");
    const completed = allDeals.filter((d) => d.status === "completed");

    // Build a row from a deal
    function dealToRow(deal: typeof allDeals[number]): (string | null)[] {
      const steps = dealStepsMap.get(deal.id) ?? [];
      return [
        // LAYCAN
        formatLaycanCell(
          deal.direction,
          deal.incoterm,
          deal.loadport,
          deal.laycanStart,
          deal.laycanEnd,
        ),
        // Counterparty
        deal.counterparty,
        // Vessel
        deal.vesselName ?? "",
        // Linkage
        deal.linkageCode ?? "",
        // Reference
        deal.externalRef ?? "",
        // OPS
        operatorInitials(
          operatorMap.get(deal.assignedOperatorId ?? ""),
          operatorMap.get(deal.secondaryOperatorId ?? ""),
        ),
        // PRICING
        formatPricing(deal.pricingType, deal.pricingFormula),
        // B/L FIGURES
        formatBlFigures(deal.contractedQty, deal.quantityMt, deal.nominatedQty),
        // DOC INSTRUCTIONS
        findStepStatus(steps, "doc"),
        // VOY/DIS ORDERS
        findStepStatus(steps, "order"),
        // (empty spacer)
        "",
        // VESSEL NOMINATION
        findStepStatus(steps, "nomination"),
        // SUPERVISION (LP/DP)
        findStepStatus(steps, "appointment"),
        // (empty spacer)
        "",
        // COA to Traders — operator-managed, leave empty
        "",
        // Discharge Nomination(our terminal) — include nomination for discharge if present
        steps.find(
          (s) =>
            s.stepType === "nomination" &&
            s.stepName.toLowerCase().includes("discharge"),
        )
          ? stepStatusToExcel(
              steps.find(
                (s) =>
                  s.stepType === "nomination" &&
                  s.stepName.toLowerCase().includes("discharge"),
              )!.status,
            )
          : "",
        // Outturn — operator-managed, leave empty
        "",
        // Freight invoice — operator-managed, leave empty
        "",
        // TAX
        taxValue(deal.loadport, deal.dischargePort),
        // INVOICE TO CP — operator-managed, leave empty
        "",
      ];
    }

    // Build the ONGOING sheet
    function buildSheetData(
      sheetDeals: typeof allDeals,
    ): (string | null)[][] {
      const rows: (string | null)[][] = [];

      // Purchase section
      const purchases = sheetDeals.filter((d) => d.direction === "buy");
      if (purchases.length > 0) {
        // Section header
        const purchaseHeaders = [...EXCEL_HEADERS];
        purchaseHeaders[0] = "P(LAYCAN)";
        rows.push(purchaseHeaders);
        for (const deal of purchases) {
          rows.push(dealToRow(deal));
        }
        // Separator
        rows.push(Array(EXCEL_HEADERS.length).fill(""));
      }

      // Sale section
      const sales = sheetDeals.filter((d) => d.direction === "sell");
      if (sales.length > 0) {
        const saleHeaders = [...EXCEL_HEADERS];
        saleHeaders[0] = "S(LAYCAN)";
        rows.push(saleHeaders);
        for (const deal of sales) {
          rows.push(dealToRow(deal));
        }
      }

      // If no deals at all, just output headers
      if (purchases.length === 0 && sales.length === 0) {
        rows.push(EXCEL_HEADERS);
      }

      return rows;
    }

    // Create workbook
    const wb = XLSX.utils.book_new();

    // ONGOING sheet
    const ongoingData = buildSheetData(ongoing);
    const wsOngoing = XLSX.utils.aoa_to_sheet(ongoingData);
    // Set column widths for readability
    wsOngoing["!cols"] = [
      { wch: 28 }, // LAYCAN
      { wch: 18 }, // Counterparty
      { wch: 20 }, // Vessel
      { wch: 14 }, // Linkage
      { wch: 12 }, // Reference
      { wch: 8 },  // OPS
      { wch: 14 }, // PRICING
      { wch: 18 }, // B/L FIGURES
      { wch: 18 }, // DOC INSTRUCTIONS
      { wch: 16 }, // VOY/DIS ORDERS
      { wch: 3 },  // spacer
      { wch: 20 }, // VESSEL NOMINATION
      { wch: 20 }, // SUPERVISION
      { wch: 3 },  // spacer
      { wch: 16 }, // COA to Traders
      { wch: 28 }, // Discharge Nomination
      { wch: 10 }, // Outturn
      { wch: 14 }, // Freight invoice
      { wch: 6 },  // TAX
      { wch: 16 }, // INVOICE TO CP
    ];
    XLSX.utils.book_append_sheet(wb, wsOngoing, "ONGOING");

    // COMPLETED sheet
    const completedData = buildSheetData(completed);
    const wsCompleted = XLSX.utils.aoa_to_sheet(completedData);
    wsCompleted["!cols"] = wsOngoing["!cols"];
    XLSX.utils.book_append_sheet(wb, wsCompleted, "COMPLETED");

    // Generate buffer
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    // Return as downloadable file
    const filename = `GASOLINE VESSELS LIST ${new Date().getFullYear()}.xlsx`;
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  },
  { roles: ["operator", "admin"] },
);
