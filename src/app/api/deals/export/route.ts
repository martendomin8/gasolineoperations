import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { deals, users, workflowInstances, workflowSteps } from "@/lib/db/schema";
import { dealFilterSchema } from "@/lib/types/deal";
import { eq, and, ilike, or, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Helpers — shared with deals route.ts
// ---------------------------------------------------------------------------

function stepStatusToDisplay(status: string | null): string | null {
  switch (status) {
    case "sent":
    case "acknowledged":
    case "done":
      return "DONE";
    case "draft_generated":
      return "DRAFT READY";
    case "needs_update":
      return "NEEDS UPDATE";
    case "cancelled":
      return "CANCELLED";
    case "received":
      return "RECEIVED";
    case "na":
      return "N/A";
    default:
      return null;
  }
}

interface ExportDeal {
  externalRef: string | null;
  linkageCode: string | null;
  counterparty: string;
  direction: string;
  product: string;
  quantityMt: string;
  contractedQty: string | null;
  nominatedQty: string | null;
  incoterm: string;
  loadport: string;
  dischargePort: string | null;
  laycanStart: string;
  laycanEnd: string;
  vesselName: string | null;
  status: string;
  pricingPeriodType: string | null;
  pricingPeriodValue: string | null;
  operatorName: string | null;
  secondaryOperatorName: string | null;
}

// ---------------------------------------------------------------------------
// Fetch deals with the same logic as the main deals list
// ---------------------------------------------------------------------------

async function fetchDealsForExport(
  tenantId: string,
  params: URLSearchParams
): Promise<ExportDeal[]> {
  const filterResult = dealFilterSchema.safeParse({
    status: params.get("status") || undefined,
    direction: params.get("direction") || undefined,
    incoterm: params.get("incoterm") || undefined,
    counterparty: params.get("counterparty") || undefined,
    linkageCode: params.get("linkageCode") || undefined,
    assignedOperatorId: params.get("assignedOperatorId") || undefined,
    search: params.get("search") || undefined,
    page: 1,
    perPage: 100, // Export up to 100 — no pagination for exports
  });

  if (!filterResult.success) {
    throw new Error("Invalid filters");
  }
  const filters = filterResult.data;

  return withTenantDb(tenantId, async (db) => {
    const conditions = [eq(deals.tenantId, tenantId)];

    if (filters.status) conditions.push(eq(deals.status, filters.status));
    if (filters.direction) conditions.push(eq(deals.direction, filters.direction));
    if (filters.incoterm) conditions.push(eq(deals.incoterm, filters.incoterm));
    if (filters.linkageCode) conditions.push(eq(deals.linkageCode, filters.linkageCode));
    if (filters.assignedOperatorId)
      conditions.push(eq(deals.assignedOperatorId, filters.assignedOperatorId));
    if (filters.search) {
      conditions.push(
        or(
          ilike(deals.counterparty, `%${filters.search}%`),
          ilike(deals.product, `%${filters.search}%`),
          ilike(deals.loadport, `%${filters.search}%`),
          ilike(deals.dischargePort, `%${filters.search}%`),
          ilike(deals.vesselName!, `%${filters.search}%`),
          ilike(deals.externalRef!, `%${filters.search}%`)
        )!
      );
    }

    const primaryOp = alias(users, "primaryOp");
    const secondaryOp = alias(users, "secondaryOp");

    const rawItems = await db
      .select({
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
        pricingPeriodType: deals.pricingPeriodType,
        pricingPeriodValue: deals.pricingPeriodValue,
        operatorName: primaryOp.name,
        secondaryOperatorName: secondaryOp.name,
      })
      .from(deals)
      .leftJoin(primaryOp, eq(deals.assignedOperatorId, primaryOp.id))
      .leftJoin(secondaryOp, eq(deals.secondaryOperatorId, secondaryOp.id))
      .where(and(...conditions))
      .orderBy(desc(deals.createdAt))
      .limit(100);

    return rawItems;
  });
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatPricing(deal: ExportDeal): string {
  const { pricingPeriodType, pricingPeriodValue } = deal;
  if (pricingPeriodType && pricingPeriodValue) {
    return `${pricingPeriodType} ${pricingPeriodValue}`;
  }
  return pricingPeriodType || "";
}

function formatOps(deal: ExportDeal): string {
  const primary = deal.operatorName || "";
  const secondary = deal.secondaryOperatorName || "";
  return secondary ? `${primary}/${secondary}` : primary;
}

function formatQty(deal: ExportDeal): string {
  return deal.contractedQty || `${deal.quantityMt} MT`;
}

// ---------------------------------------------------------------------------
// Column definitions for export
// ---------------------------------------------------------------------------

const EXPORT_HEADERS = [
  "Reference",
  "Linkage",
  "Counterparty",
  "Direction",
  "Product",
  "Quantity",
  "Incoterm",
  "Loadport",
  "Discharge Port",
  "Laycan Start",
  "Laycan End",
  "Vessel",
  "Status",
  "Pricing Period",
  "Ops",
];

function dealToRow(deal: ExportDeal): string[] {
  return [
    deal.externalRef || "",
    deal.linkageCode || "",
    deal.counterparty,
    deal.direction.toUpperCase(),
    deal.product,
    formatQty(deal),
    deal.incoterm,
    deal.loadport,
    deal.dischargePort || "",
    formatDate(deal.laycanStart),
    formatDate(deal.laycanEnd),
    deal.vesselName || "",
    deal.status.toUpperCase(),
    formatPricing(deal),
    formatOps(deal),
  ];
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCSV(exportDeals: ExportDeal[]): string {
  const lines: string[] = [];
  lines.push(EXPORT_HEADERS.map(escapeCSV).join(","));
  for (const deal of exportDeals) {
    lines.push(dealToRow(deal).map(escapeCSV).join(","));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Excel export
// ---------------------------------------------------------------------------

function buildExcel(
  exportDeals: ExportDeal[]
): Buffer {
  const wb = XLSX.utils.book_new();

  const ongoing = exportDeals.filter(
    (d) => d.status !== "completed" && d.status !== "cancelled"
  );
  const completed = exportDeals.filter((d) => d.status === "completed");

  // ONGOING sheet
  const ongoingData = [EXPORT_HEADERS, ...ongoing.map(dealToRow)];
  const ongoingSheet = XLSX.utils.aoa_to_sheet(ongoingData);
  // Set column widths
  ongoingSheet["!cols"] = EXPORT_HEADERS.map((h) => ({
    wch: Math.max(h.length, 14),
  }));
  XLSX.utils.book_append_sheet(wb, ongoingSheet, "ONGOING");

  // COMPLETED sheet
  const completedData = [EXPORT_HEADERS, ...completed.map(dealToRow)];
  const completedSheet = XLSX.utils.aoa_to_sheet(completedData);
  completedSheet["!cols"] = EXPORT_HEADERS.map((h) => ({
    wch: Math.max(h.length, 14),
  }));
  XLSX.utils.book_append_sheet(wb, completedSheet, "COMPLETED");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf as Buffer;
}

// ---------------------------------------------------------------------------
// PDF export (HTML with print stylesheet)
// ---------------------------------------------------------------------------

function buildPrintHTML(exportDeals: ExportDeal[]): string {
  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const rows = exportDeals
    .map(
      (deal) =>
        `<tr>${dealToRow(deal)
          .map((v) => `<td>${escapeHTML(v)}</td>`)
          .join("")}</tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>NEFGO. Deals Export - ${today}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; color: #1a1a1a; padding: 20px; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; border-bottom: 3px solid #d97706; padding-bottom: 8px; }
  .header h1 { font-size: 20px; font-weight: 800; letter-spacing: 1px; }
  .header h1 span { color: #d97706; }
  .header .date { font-size: 11px; color: #666; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { background: #f5f5f5; border: 1px solid #ddd; padding: 5px 6px; text-align: left; font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px; white-space: nowrap; }
  td { border: 1px solid #ddd; padding: 4px 6px; white-space: nowrap; }
  tr:nth-child(even) { background: #fafafa; }
  .footer { margin-top: 12px; font-size: 9px; color: #999; text-align: right; }
  @media print {
    body { padding: 0; }
    .header { border-bottom-color: #d97706; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    @page { size: landscape; margin: 10mm; }
  }
</style>
</head>
<body>
<div class="header">
  <h1>NEFGO<span>.</span></h1>
  <div class="date">Deals Export &mdash; ${escapeHTML(today)}</div>
</div>
<table>
  <thead><tr>${EXPORT_HEADERS.map((h) => `<th>${escapeHTML(h)}</th>`).join("")}</tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">Generated ${escapeHTML(today)} &mdash; NEFGO.</div>
<script>window.onload = function() { window.print(); };</script>
</body>
</html>`;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// DOCX export (HTML saved as .doc — Word-compatible)
// ---------------------------------------------------------------------------

function buildDocHTML(exportDeals: ExportDeal[]): string {
  const today = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const rows = exportDeals
    .map(
      (deal) =>
        `<tr>${dealToRow(deal)
          .map((v) => `<td>${escapeHTML(v)}</td>`)
          .join("")}</tr>`
    )
    .join("\n");

  // Word-compatible HTML with mso namespace for better rendering
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8" />
<title>NEFGO. Deals Export</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  body { font-family: Calibri, sans-serif; font-size: 10pt; }
  h1 { font-size: 18pt; font-weight: bold; margin-bottom: 4pt; }
  h1 span { color: #d97706; }
  .date { font-size: 9pt; color: #666; margin-bottom: 12pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th { background: #f0f0f0; border: 1pt solid #ccc; padding: 3pt 5pt; text-align: left; font-weight: bold; text-transform: uppercase; font-size: 8pt; }
  td { border: 1pt solid #ccc; padding: 2pt 5pt; }
  .footer { margin-top: 12pt; font-size: 8pt; color: #999; text-align: right; }
</style>
</head>
<body>
<h1>NEFGO<span>.</span></h1>
<div class="date">Deals Export &mdash; ${escapeHTML(today)}</div>
<table>
  <thead><tr>${EXPORT_HEADERS.map((h) => `<th>${escapeHTML(h)}</th>`).join("")}</tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">Generated ${escapeHTML(today)} &mdash; NEFGO.</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

const VALID_FORMATS = ["pdf", "docx", "csv", "xlsx"] as const;
type ExportFormat = (typeof VALID_FORMATS)[number];

export const GET = withAuth(async (req, _ctx, session) => {
  const url = new URL(req.url);
  const format = url.searchParams.get("format") as ExportFormat | null;

  if (!format || !VALID_FORMATS.includes(format)) {
    return NextResponse.json(
      { error: "Invalid format. Must be one of: pdf, docx, csv, xlsx" },
      { status: 400 }
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const exportDeals = await fetchDealsForExport(
      session.user.tenantId,
      url.searchParams
    );

    switch (format) {
      case "csv": {
        const csv = buildCSV(exportDeals);
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="deals-export-${today}.csv"`,
          },
        });
      }

      case "xlsx": {
        const buffer = buildExcel(exportDeals);
        return new NextResponse(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="deals-export-${today}.xlsx"`,
          },
        });
      }

      case "pdf": {
        const html = buildPrintHTML(exportDeals);
        return new NextResponse(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      case "docx": {
        const docHtml = buildDocHTML(exportDeals);
        return new NextResponse(docHtml, {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition": `attachment; filename="deals-export-${today}.docx"`,
          },
        });
      }
    }
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: "Failed to generate export" },
      { status: 500 }
    );
  }
});
