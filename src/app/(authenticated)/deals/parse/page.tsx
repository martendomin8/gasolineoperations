"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Sparkles,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Wand2,
  ClipboardPaste,
} from "lucide-react";
import Link from "next/link";

// ============================================================
// TYPES
// ============================================================

interface ParsedFields {
  counterparty: string | null;
  direction: "buy" | "sell" | null;
  product: string | null;
  quantity_mt: number | null;
  incoterm: "FOB" | "CIF" | "CFR" | "DAP" | "FCA" | null;
  loadport: string | null;
  discharge_port: string | null;
  laycan_start: string | null;
  laycan_end: string | null;
  vessel_name: string | null;
  vessel_imo: string | null;
  pricing_formula: string | null;
  special_instructions: string | null;
  external_ref: string | null;
}

interface ParseResult {
  fields: ParsedFields;
  confidenceScores: Record<string, number>;
  mode: "ai" | "demo";
  demoNotice?: string;
}

// ============================================================
// CONFIDENCE HELPERS
// ============================================================

function ConfidenceIndicator({ score }: { score: number }) {
  if (score >= 0.85) {
    return (
      <span className="flex items-center gap-1 text-[var(--color-success)]">
        <CheckCircle2 className="h-3 w-3" />
        <span className="text-[0.625rem] font-mono uppercase tracking-wider">{Math.round(score * 100)}%</span>
      </span>
    );
  }
  if (score >= 0.5) {
    return (
      <span className="flex items-center gap-1 text-[var(--color-accent)]">
        <AlertTriangle className="h-3 w-3" />
        <span className="text-[0.625rem] font-mono uppercase tracking-wider">{Math.round(score * 100)}%</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[var(--color-danger)]">
      <AlertTriangle className="h-3 w-3" />
      <span className="text-[0.625rem] font-mono uppercase tracking-wider">
        {score > 0 ? `${Math.round(score * 100)}%` : "—"}
      </span>
    </span>
  );
}

function confidenceBorder(score: number) {
  if (score >= 0.85) return "border-[var(--color-success)] border-opacity-30";
  if (score >= 0.5) return "border-[var(--color-accent)] border-opacity-40";
  return "border-[var(--color-danger)] border-opacity-30";
}

// ============================================================
// SAMPLE EMAILS
// ============================================================

const SAMPLE_EMAILS = [
  {
    label: "CIF Sale to Shell",
    text: `Hi team,

Please note the following deal:

Seller: EuroGas Trading BV
Buyer: Shell Trading
Product: EBOB
Quantity: 30,000 MT (+/- 5%)
Incoterm: CIF
Load Port: Amsterdam
Discharge: New York
Laycan: 5/7 April 2026
Vessel: MT Gannet Arrow, IMO 9786543
Price: Platts CIF NWE Cargo -$5.00/MT

Regards,
Thomas Berg
Trader`,
  },
  {
    label: "FOB Buy from Vitol",
    text: `Deal recap — EG-2026-042

We confirm purchase from Vitol SA:
15,000 MT Reformate FOB Klaipeda
Laycan 10-12 April 2026
Price: Platts FOB Baltic +$2.50/MT
Vessel TBC`,
  },
  {
    label: "DAP Sale to Trafigura",
    text: `Thomas,

Confirmed sold to Trafigura:
28,000 MT RBOB DAP Houston
Load: Amsterdam
Laycan: 15-17 April 2026
Vessel TBC
SCAC code required on B/L for US destination`,
  },
];

// ============================================================
// FIELD ROW
// ============================================================

interface FieldRowProps {
  label: string;
  fieldKey: keyof ParsedFields;
  value: string;
  score: number;
  onChange: (key: keyof ParsedFields, val: string) => void;
  type?: "text" | "number" | "select";
  options?: string[];
}

function FieldRow({ label, fieldKey, value, score, onChange, type = "text", options }: FieldRowProps) {
  return (
    <div className={`flex items-center gap-3 p-2.5 rounded-[var(--radius-sm)] border ${confidenceBorder(score)} bg-[var(--color-surface-1)]`}>
      <div className="w-36 flex-shrink-0">
        <p className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">
          {label}
        </p>
        <div className="mt-0.5">
          <ConfidenceIndicator score={score} />
        </div>
      </div>

      <div className="flex-1">
        {type === "select" && options ? (
          <select
            value={value}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            className="w-full text-sm bg-transparent text-[var(--color-text-primary)] border-0 outline-none focus:outline-none py-0 font-mono"
          >
            <option value="">—</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            type={type}
            value={value}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            placeholder="—"
            className="w-full text-sm bg-transparent text-[var(--color-text-primary)] border-0 outline-none focus:outline-none font-mono placeholder:text-[var(--color-text-tertiary)]"
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function ParseDealPage() {
  const router = useRouter();
  const [rawText, setRawText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  const handleParse = async () => {
    if (!rawText.trim()) return;
    setParsing(true);
    setError(null);
    setResult(null);
    setEditedFields({});

    const res = await fetch("/api/deals/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText }),
    });

    const data = await res.json();
    setParsing(false);

    if (!res.ok) {
      setError(data.error ?? "Parsing failed");
      return;
    }

    setResult(data);
    // Seed editable fields
    const initial: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.fields)) {
      initial[k] = v != null ? String(v) : "";
    }
    setEditedFields(initial);
  };

  const updateField = (key: keyof ParsedFields, val: string) => {
    setEditedFields((prev) => ({ ...prev, [key]: val }));
  };

  const handleCreateDeal = async () => {
    setCreating(true);
    const res = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        counterparty: editedFields.counterparty || undefined,
        direction: editedFields.direction || undefined,
        product: editedFields.product || undefined,
        quantityMt: editedFields.quantity_mt ? Number(editedFields.quantity_mt) : undefined,
        incoterm: editedFields.incoterm || undefined,
        loadport: editedFields.loadport || undefined,
        dischargePort: editedFields.discharge_port || undefined,
        laycanStart: editedFields.laycan_start || undefined,
        laycanEnd: editedFields.laycan_end || undefined,
        vesselName: editedFields.vessel_name || null,
        vesselImo: editedFields.vessel_imo || null,
        pricingFormula: editedFields.pricing_formula || null,
        specialInstructions: editedFields.special_instructions || null,
        externalRef: editedFields.external_ref || null,
        sourceRawText: rawText,
      }),
    });

    const data = await res.json();
    setCreating(false);

    if (res.ok && data.id) {
      router.push(`/deals/${data.id}`);
    } else {
      setError(data.error ?? "Failed to create deal");
    }
  };

  const lowConfidenceCount = result
    ? Object.values(result.confidenceScores).filter((s) => s > 0 && s < 0.85).length
    : 0;

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/deals"
          className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">AI Deal Parser</h1>
            <Badge variant="accent">
              <Sparkles className="h-3 w-3 mr-1" />
              Claude
            </Badge>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Paste a trader email or deal recap to extract structured deal data
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left — raw text input */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Raw Email / Recap</CardTitle>
              <div className="flex items-center gap-1 ml-auto">
                {SAMPLE_EMAILS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => setRawText(s.text)}
                    className="text-[0.625rem] px-2 py-1 rounded bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-4)] transition-colors uppercase tracking-wider"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </CardHeader>

            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`Paste the trader email or deal recap here...

Example:
Sold to Shell Trading
30,000 MT EBOB CIF New York
Load Amsterdam, Laycan 5/7 April
Vessel MT Gannet Arrow IMO 9786543
Price: Platts CIF NWE -$5/MT`}
              className="w-full h-72 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] bg-transparent border-0 outline-none resize-none font-mono leading-relaxed"
            />

            <div className="flex items-center gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
              <Button
                variant="primary"
                onClick={handleParse}
                disabled={parsing || !rawText.trim()}
                className="flex-1"
              >
                {parsing ? (
                  <>
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Parsing…
                  </>
                ) : (
                  <>
                    <Wand2 className="h-3.5 w-3.5" />
                    Parse with AI
                  </>
                )}
              </Button>
              {rawText && (
                <button
                  onClick={() => { setRawText(""); setResult(null); setError(null); }}
                  className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </Card>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-muted)] border border-[var(--color-danger)] border-opacity-30">
              <AlertTriangle className="h-4 w-4 text-[var(--color-danger)] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--color-danger)]">{error}</p>
            </div>
          )}

          {result?.demoNotice && (
            <div className="flex items-start gap-2 p-3 rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] border border-[var(--color-accent)] border-opacity-30">
              <Sparkles className="h-4 w-4 text-[var(--color-accent)] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-[var(--color-accent-text)]">Demo Mode</p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{result.demoNotice}</p>
                <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                  Add <span className="font-mono">ANTHROPIC_API_KEY</span> to .env for full AI extraction.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right — extracted fields */}
        <div className="space-y-4">
          {result ? (
            <Card>
              <CardHeader>
                <CardTitle>Extracted Fields</CardTitle>
                <div className="flex items-center gap-2 ml-auto">
                  {lowConfidenceCount > 0 && (
                    <Badge variant="accent">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      {lowConfidenceCount} to review
                    </Badge>
                  )}
                  <Badge variant={result.mode === "ai" ? "success" : "muted"}>
                    {result.mode === "ai" ? "AI" : "Demo"}
                  </Badge>
                </div>
              </CardHeader>

              <div className="space-y-1.5">
                {/* Core */}
                <p className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">
                  Core
                </p>
                <FieldRow label="Counterparty" fieldKey="counterparty" value={editedFields.counterparty ?? ""} score={result.confidenceScores.counterparty ?? 0} onChange={updateField} />
                <FieldRow label="Direction" fieldKey="direction" value={editedFields.direction ?? ""} score={result.confidenceScores.direction ?? 0} onChange={updateField} type="select" options={["buy", "sell"]} />
                <FieldRow label="Product" fieldKey="product" value={editedFields.product ?? ""} score={result.confidenceScores.product ?? 0} onChange={updateField} />
                <FieldRow label="Quantity (MT)" fieldKey="quantity_mt" value={editedFields.quantity_mt ?? ""} score={result.confidenceScores.quantity_mt ?? 0} onChange={updateField} type="number" />
                <FieldRow label="Incoterm" fieldKey="incoterm" value={editedFields.incoterm ?? ""} score={result.confidenceScores.incoterm ?? 0} onChange={updateField} type="select" options={["FOB", "CIF", "CFR", "DAP", "FCA"]} />

                {/* Logistics */}
                <p className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mt-3 mb-1">
                  Logistics
                </p>
                <FieldRow label="Loadport" fieldKey="loadport" value={editedFields.loadport ?? ""} score={result.confidenceScores.loadport ?? 0} onChange={updateField} />
                <FieldRow label="Discharge Port" fieldKey="discharge_port" value={editedFields.discharge_port ?? ""} score={result.confidenceScores.discharge_port ?? 0} onChange={updateField} />
                <FieldRow label="Laycan Start" fieldKey="laycan_start" value={editedFields.laycan_start ?? ""} score={result.confidenceScores.laycan_start ?? 0} onChange={updateField} />
                <FieldRow label="Laycan End" fieldKey="laycan_end" value={editedFields.laycan_end ?? ""} score={result.confidenceScores.laycan_end ?? 0} onChange={updateField} />

                {/* Vessel */}
                <p className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mt-3 mb-1">
                  Vessel
                </p>
                <FieldRow label="Vessel Name" fieldKey="vessel_name" value={editedFields.vessel_name ?? ""} score={result.confidenceScores.vessel_name ?? 0} onChange={updateField} />
                <FieldRow label="Vessel IMO" fieldKey="vessel_imo" value={editedFields.vessel_imo ?? ""} score={result.confidenceScores.vessel_imo ?? 0} onChange={updateField} />

                {/* Additional */}
                <p className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mt-3 mb-1">
                  Additional
                </p>
                <FieldRow label="Pricing Formula" fieldKey="pricing_formula" value={editedFields.pricing_formula ?? ""} score={result.confidenceScores.pricing_formula ?? 0} onChange={updateField} />
                <FieldRow label="External Ref" fieldKey="external_ref" value={editedFields.external_ref ?? ""} score={result.confidenceScores.external_ref ?? 0} onChange={updateField} />
                <FieldRow label="Special Instr." fieldKey="special_instructions" value={editedFields.special_instructions ?? ""} score={result.confidenceScores.special_instructions ?? 0} onChange={updateField} />
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 pt-3 border-t border-[var(--color-border-subtle)] mt-3">
                <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
                  <CheckCircle2 className="h-3 w-3 text-[var(--color-success)]" />
                  ≥85% confident
                </div>
                <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
                  <AlertTriangle className="h-3 w-3 text-[var(--color-accent)]" />
                  50–84% — review
                </div>
                <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
                  <AlertTriangle className="h-3 w-3 text-[var(--color-danger)]" />
                  &lt;50% — fill in
                </div>
              </div>

              {/* Create deal button */}
              <div className="pt-3 border-t border-[var(--color-border-subtle)] mt-1">
                <Button
                  variant="primary"
                  onClick={handleCreateDeal}
                  disabled={creating}
                  className="w-full"
                >
                  {creating ? (
                    <>
                      <div className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Creating deal…
                    </>
                  ) : (
                    <>
                      Create Deal
                      <ChevronRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </Button>
                {lowConfidenceCount > 0 && (
                  <p className="text-xs text-[var(--color-text-tertiary)] text-center mt-1.5">
                    {lowConfidenceCount} field{lowConfidenceCount > 1 ? "s" : ""} need review — edit above before creating
                  </p>
                )}
              </div>
            </Card>
          ) : (
            <Card>
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <div className="h-12 w-12 rounded-full bg-[var(--color-accent-muted)] flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-[var(--color-accent)]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    Paste a deal email
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1 max-w-xs leading-relaxed">
                    The AI will extract counterparty, product, quantity, incoterm, ports, laycan,
                    vessel and pricing — with per-field confidence scores.
                  </p>
                </div>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  Try one of the sample emails →
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
