"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState, useRef } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

// Deal fields available for mapping
const DEAL_FIELDS = [
  { value: "", label: "— Skip —" },
  { value: "counterparty", label: "Counterparty *" },
  { value: "direction", label: "Direction (buy/sell) *" },
  { value: "product", label: "Product *" },
  { value: "quantityMt", label: "Quantity (MT) *" },
  { value: "contractedQty", label: "Contracted Qty (e.g. 37000MT +/-10%)" },
  { value: "incoterm", label: "Incoterm *" },
  { value: "loadport", label: "Loadport *" },
  { value: "dischargePort", label: "Discharge Port *" },
  { value: "laycanStart", label: "Laycan Start *" },
  { value: "laycanEnd", label: "Laycan End *" },
  { value: "vesselName", label: "Vessel Name" },
  { value: "vesselImo", label: "Vessel IMO" },
  { value: "externalRef", label: "External Reference" },
  { value: "linkageCode", label: "Linkage Code" },
  { value: "pricingFormula", label: "Pricing Formula" },
  { value: "specialInstructions", label: "Special Instructions" },
  { value: "_laycanCell", label: "Laycan Cell (auto-parse P/S(...))" },
  { value: "_blFigures", label: "B/L Figures (auto-parse qty)" },
];

// Auto-mapping hints (by column header name)
const AUTO_MAP: Record<string, string> = {
  counterparty: "counterparty", cpty: "counterparty", "counter party": "counterparty",
  direction: "direction", "buy/sell": "direction", "b/s": "direction",
  product: "product", grade: "product",
  quantity: "quantityMt", qty: "quantityMt", "quantity_mt": "quantityMt", mt: "quantityMt",
  "b/l figures": "_blFigures", "bl figures": "_blFigures",
  incoterm: "incoterm", terms: "incoterm",
  loadport: "loadport", "load port": "loadport", "loading port": "loadport",
  "discharge port": "dischargePort", dischargeport: "dischargePort", "disch port": "dischargePort",
  "laycan start": "laycanStart", laycan_start: "laycanStart", "load date": "laycanStart",
  "laycan end": "laycanEnd", laycan_end: "laycanEnd",
  vessel: "vesselName", "vessel name": "vesselName", "m/v": "vesselName",
  imo: "vesselImo", "vessel imo": "vesselImo",
  ref: "externalRef", reference: "externalRef", "external ref": "externalRef",
  linkage: "linkageCode", "linkage code": "linkageCode",
  pricing: "pricingFormula",
};


/**
 * Detect the GASOLINE VESSELS LIST format.
 * This Excel has "PURCHASE" as the first column header, with real headers
 * like P(LAYCAN), Counterparty, Vessel etc. in row 2+ data.
 * Columns show as __EMPTY, __EMPTY_1, etc.
 */
function isGasolineVesselsList(headers: string[], rows: Record<string, unknown>[]): boolean {
  const first = headers[0]?.toUpperCase() ?? "";
  if (first === "PURCHASE" || first === "SALE") return true;
  // Check if any cell in the first few rows matches the P(...) or S(...) pattern
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const val = String(rows[i]?.[headers[0]] ?? "");
    if (/^[PS]\s*\(/.test(val)) return true;
  }
  return false;
}

/**
 * Pre-process GASOLINE VESSELS LIST rows:
 * - Filter out section headers (SALE, PURCHASE rows), empty rows, and sub-headers
 * - Tag each row with direction from the P/S cell
 */
function preprocessGasolineRows(
  headers: string[],
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  const firstCol = headers[0];
  const filtered: Record<string, unknown>[] = [];

  for (const row of rows) {
    const cell0 = String(row[firstCol] ?? "").trim();

    // Skip empty rows
    if (!cell0 && !row[headers[1]]) continue;

    // Skip section label rows ("SALE", "PURCHASE", or header rows like "S(LAYCAN)")
    const upper = cell0.toUpperCase();
    if (upper === "SALE" || upper === "PURCHASE" || upper === "PURCHASE + SALE") continue;
    if (upper.startsWith("P(LAYCAN") || upper.startsWith("S(LAYCAN")) continue;

    // Skip rows where the first cell doesn't match the P/S(...) data pattern
    // and has no counterparty — these are likely sub-headers or totals
    if (!/^[PS]\s*\(/i.test(cell0) && !row[headers[1]]) continue;

    filtered.push(row);
  }

  return filtered;
}

/**
 * Build auto-mapping for GASOLINE VESSELS LIST format using example data from rows.
 */
function buildGasolineAutoMapping(
  headers: string[],
  rows: Record<string, unknown>[]
): Record<string, string> {
  const autoMapping: Record<string, string> = {};

  // First column is always the laycan cell (P/S(...))
  autoMapping[headers[0]] = "_laycanCell";

  // For __EMPTY columns, try to infer from the first data row's content
  // or from known positional patterns in the gasoline vessels list
  const POSITIONAL_MAP: Record<number, string> = {
    1: "counterparty",    // __EMPTY → Counterparty
    2: "vesselName",      // __EMPTY_1 → Vessel
    3: "linkageCode",     // __EMPTY_2 → Linkage
    4: "externalRef",     // __EMPTY_3 → Reference
    // 5: OPS (operator name) — skip, not a deal field
    6: "pricingFormula",  // __EMPTY_5 → PRICING
    7: "_blFigures",      // __EMPTY_6 → B/L FIGURES
  };

  for (let i = 1; i < headers.length; i++) {
    const header = headers[i];
    const normalized = header.toLowerCase().trim();

    // First try normal auto-map by header name
    if (AUTO_MAP[normalized]) {
      autoMapping[header] = AUTO_MAP[normalized];
      continue;
    }

    // For __EMPTY columns, use positional mapping
    if (header.startsWith("__EMPTY") || header === "PURCHASE" || header === "SALE") {
      if (POSITIONAL_MAP[i]) {
        autoMapping[header] = POSITIONAL_MAP[i];
      }
    }
  }

  return autoMapping;
}

type Step = "upload" | "map" | "preview";

export default function ImportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [validation, setValidation] = useState<{ valid: any[]; invalid: any[]; duplicates: any[] } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);

  const [isGasolineFormat, setIsGasolineFormat] = useState(false);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target?.result;
      const wb = XLSX.read(data, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false });

      if (jsonData.length === 0) {
        toast.error("No data found in file");
        return;
      }

      const cols = Object.keys(jsonData[0]);
      const gasolineFormat = isGasolineVesselsList(cols, jsonData);
      setIsGasolineFormat(gasolineFormat);

      if (gasolineFormat) {
        // Pre-process: filter out section headers, empty rows, sub-headers
        const cleaned = preprocessGasolineRows(cols, jsonData);
        if (cleaned.length === 0) {
          toast.error("No data rows found after filtering headers");
          return;
        }
        setHeaders(cols);
        setRows(cleaned);
        setFileName(file.name);

        // Build smart auto-mapping for this format
        const autoMapping = buildGasolineAutoMapping(cols, cleaned);
        setMapping(autoMapping);

        toast.success(`Detected GASOLINE VESSELS LIST format — ${cleaned.length} data rows, ${jsonData.length - cleaned.length} header/empty rows skipped`);
      } else {
        setHeaders(cols);
        setRows(jsonData);
        setFileName(file.name);

        // Standard auto-map by column header name
        const autoMapping: Record<string, string> = {};
        cols.forEach((col) => {
          const normalized = col.toLowerCase().trim();
          if (AUTO_MAP[normalized]) {
            autoMapping[col] = AUTO_MAP[normalized];
          }
        });
        setMapping(autoMapping);
      }

      setStep("map");
    };
    reader.readAsArrayBuffer(file);
  }, []);

  async function handleValidate() {
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, mapping }),
    });

    if (!res.ok) {
      toast.error("Validation failed");
      return;
    }

    const result = await res.json();
    setValidation(result);
    setSelected(new Set(result.valid.map((v: any) => v.rowIndex)));
    setStep("preview");
  }

  async function handleImport() {
    if (!validation) return;
    setImporting(true);

    const dealsToImport = validation.valid
      .filter((v) => selected.has(v.rowIndex))
      .map((v) => v.data);

    const res = await fetch("/api/import/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deals: dealsToImport }),
    });

    if (!res.ok) {
      toast.error("Import failed");
      setImporting(false);
      return;
    }

    const result = await res.json();
    toast.success(`Imported ${result.imported} deals`);
    router.push("/deals");
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Excel Import</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Import deals from your existing Excel database
        </p>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2">
        {(["upload", "map", "preview"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step === s
                  ? "bg-[var(--color-accent)] text-[var(--color-text-inverse)]"
                  : i < ["upload", "map", "preview"].indexOf(step)
                    ? "bg-[var(--color-success-muted)] text-[var(--color-success)]"
                    : "bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)]"
              }`}
            >
              {i + 1}
            </div>
            <span className={`text-xs uppercase tracking-wide ${
              step === s ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]"
            }`}>
              {s === "upload" ? "Upload" : s === "map" ? "Map Columns" : "Preview & Import"}
            </span>
            {i < 2 && <ArrowRight className="h-3 w-3 text-[var(--color-text-tertiary)] mx-1" />}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <Card className="flex flex-col items-center justify-center py-16">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <div
            className="flex flex-col items-center gap-4 cursor-pointer group"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <div className="h-16 w-16 rounded-[var(--radius-xl)] bg-[var(--color-surface-3)] flex items-center justify-center group-hover:bg-[var(--color-accent-muted)] transition-colors">
              <FileSpreadsheet className="h-8 w-8 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-accent)] transition-colors" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                Drop your Excel file here or click to browse
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                Supports .xlsx, .xls, and .csv
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Step 2: Column Mapping */}
      {step === "map" && (
        <Card>
          <CardHeader>
            <CardTitle>
              Map Columns — {fileName}
              <span className="text-xs text-[var(--color-text-tertiary)] font-normal ml-2">
                ({rows.length} rows)
              </span>
              {isGasolineFormat && (
                <Badge variant="muted" className="ml-2 text-xs">
                  GASOLINE VESSELS LIST
                </Badge>
              )}
            </CardTitle>
            {isGasolineFormat && (
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                Auto-detected format. &quot;Laycan Cell&quot; will extract direction, incoterm, loadport, and laycan dates from P/S(...) cells. &quot;B/L Figures&quot; will parse quantity.
              </p>
            )}
          </CardHeader>
          <div className="space-y-3">
            {headers.map((header, colIdx) => {
              // Friendly column names for gasoline format __EMPTY columns
              const GASOLINE_COL_NAMES: Record<number, string> = {
                0: "Laycan (P/S)",
                1: "Counterparty",
                2: "Vessel",
                3: "Linkage",
                4: "Reference",
                5: "OPS (operator)",
                6: "Pricing",
                7: "B/L Figures",
              };
              const displayName = isGasolineFormat && header.startsWith("__EMPTY")
                ? GASOLINE_COL_NAMES[colIdx] ?? header
                : isGasolineFormat && colIdx === 0
                  ? GASOLINE_COL_NAMES[0] ?? header
                  : header;

              return (
              <div key={header} className="flex items-center gap-4">
                <div className="flex-1">
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">{displayName}</span>
                  {isGasolineFormat && displayName !== header && (
                    <span className="text-xs text-[var(--color-text-tertiary)] ml-1">({header})</span>
                  )}
                  <span className="text-xs text-[var(--color-text-tertiary)] ml-2">
                    e.g. {String(rows[0]?.[header] ?? "").slice(0, 40)}
                  </span>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
                <Select
                  options={DEAL_FIELDS}
                  value={mapping[header] || ""}
                  onChange={(e) =>
                    setMapping((prev) => ({ ...prev, [header]: e.target.value }))
                  }
                  className="w-56"
                />
              </div>
              );
            })}
          </div>
          <div className="flex gap-3 mt-6 pt-4 border-t border-[var(--color-border-subtle)]">
            <Button onClick={handleValidate}>
              Validate & Preview
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" onClick={() => setStep("upload")}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
          </div>
        </Card>
      )}

      {/* Step 3: Preview & Import */}
      {step === "preview" && validation && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <Card className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-[var(--color-success)]" />
              <div>
                <p className="text-lg font-bold text-[var(--color-text-primary)] font-mono">
                  {validation.valid.length}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)] uppercase">Valid</p>
              </div>
            </Card>
            <Card className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-[var(--color-warning)]" />
              <div>
                <p className="text-lg font-bold text-[var(--color-text-primary)] font-mono">
                  {validation.duplicates.length}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)] uppercase">Duplicates</p>
              </div>
            </Card>
            <Card className="flex items-center gap-3">
              <XCircle className="h-5 w-5 text-[var(--color-danger)]" />
              <div>
                <p className="text-lg font-bold text-[var(--color-text-primary)] font-mono">
                  {validation.invalid.length}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)] uppercase">Invalid</p>
              </div>
            </Card>
          </div>

          {/* Valid rows */}
          {validation.valid.length > 0 && (
            <Card padding="none">
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Valid Rows ({selected.size} selected)
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (selected.size === validation.valid.length) {
                      setSelected(new Set());
                    } else {
                      setSelected(new Set(validation.valid.map((v) => v.rowIndex)));
                    }
                  }}
                >
                  {selected.size === validation.valid.length ? "Deselect All" : "Select All"}
                </Button>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {validation.valid.map((v) => (
                  <label
                    key={v.rowIndex}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer border-b border-[var(--color-border-subtle)] last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(v.rowIndex)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(v.rowIndex)) next.delete(v.rowIndex);
                        else next.add(v.rowIndex);
                        setSelected(next);
                      }}
                      className="accent-[var(--color-accent)]"
                    />
                    <span className="text-sm text-[var(--color-text-primary)]">
                      {v.data.counterparty} — {v.data.direction} {v.data.product} — {Number(v.data.quantityMt).toLocaleString()} MT
                    </span>
                    <Badge variant="muted" className="ml-auto">{v.data.incoterm}</Badge>
                  </label>
                ))}
              </div>
            </Card>
          )}

          {/* Invalid rows */}
          {validation.invalid.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Invalid Rows</CardTitle>
              </CardHeader>
              <div className="space-y-2">
                {validation.invalid.map((inv) => (
                  <div key={inv.rowIndex} className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-muted)] border border-[var(--color-danger)]">
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">Row {inv.rowIndex + 1}</span>
                    <ul className="mt-1 space-y-0.5">
                      {inv.errors.map((err: string, i: number) => (
                        <li key={i} className="text-xs text-[var(--color-danger)]">{err}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button onClick={handleImport} loading={importing} disabled={selected.size === 0}>
              Import {selected.size} Deal{selected.size !== 1 ? "s" : ""}
            </Button>
            <Button variant="ghost" onClick={() => setStep("map")}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Mapping
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
