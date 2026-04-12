"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Wand2,
  Shuffle,
  Zap,
  FlaskConical,
  ChevronDown,
  ChevronUp,
  Link2,
  List,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { Dialog } from "@/components/ui/dialog";
import { FileDropZone } from "@/components/ui/file-drop-zone";

// ============================================================
// TYPES
// ============================================================

interface ParsedFields {
  counterparty: string | null;
  direction: "buy" | "sell" | null;
  product: string | null;
  quantity_mt: number | null;
  contracted_qty: string | null;
  incoterm: "FOB" | "CIF" | "CFR" | "DAP" | "FCA" | null;
  loadport: string | null;
  discharge_port: string | null;
  laycan_start: string | null;
  laycan_end: string | null;
  vessel_name: string | null;
  vessel_imo: string | null;
  pricing_formula: string | null;
  pricing_period_type: "BL" | "NOR" | "Fixed" | "EFP" | null;
  pricing_period_value: string | null;
  special_instructions: string | null;
  external_ref: string | null;
}

interface ParseResult {
  fields: ParsedFields;
  confidenceScores: Record<string, number>;
  mode: "ai" | "demo";
  demoNotice?: string;
}

interface LinkageSuggestion {
  linkageId: string;
  displayName: string;
  score: number;
  reason: string;
  deals: Array<{
    id: string;
    counterparty: string;
    direction: "buy" | "sell";
    quantityMt: number;
    product: string;
  }>;
}

// ============================================================
// SAMPLE EMAIL FIXTURES
// ============================================================

interface SampleEmail {
  id: string;
  label: string;
  tag: string;
  tagVariant: "accent" | "info" | "success" | "warning" | "danger" | "muted";
  /** What makes this fixture interesting for testing */
  testFocus: string;
  text: string;
}

const SAMPLE_EMAILS: SampleEmail[] = [
  // ── Clean / structured ──────────────────────────────────────
  {
    id: "cif-sale-ara-clean",
    label: "CIF Sale ARA — clean",
    tag: "CIF · SELL",
    tagVariant: "accent",
    testFocus: "Happy path — all fields present, high confidence expected",
    text: `Hi team,

Please note the following confirmed deal:

Seller: EuroGas Trading BV
Buyer: Shell Trading Rotterdam
Product: EBOB (UNL95)
Quantity: 30,000 MT (+/- 5%)
Incoterm: CIF
Load Port: Amsterdam
Discharge: New York
Laycan: 5/7 April 2026
Vessel: MT Gannet Arrow, IMO 9786543
Price: Platts CIF NWE Cargo -$5.00/MT

Special: SCAC code required on B/L for US destination.

Regards,
Thomas Berg — Trader`,
  },

  {
    id: "fob-buy-klaipeda-clean",
    label: "FOB Buy Klaipeda — clean",
    tag: "FOB · BUY",
    tagVariant: "info",
    testFocus: "FOB buy — triggers Klaipeda terminal workflow",
    text: `Deal recap — EG-2026-042

Purchase confirmed from Vitol SA:
15,000 MT Reformate FOB Klaipeda
Laycan 10-12 April 2026
Price: Platts FOB Baltic +$2.50/MT
Vessel: MT Nordic Hawk, IMO 9341298`,
  },

  {
    id: "cfr-sale-med",
    label: "CFR Sale Mediterranean",
    tag: "CFR · SELL",
    tagVariant: "accent",
    testFocus: "CFR — similar to CIF, different liability. Med port.",
    text: `Confirm sale to Repsol Trading:

Product: RBOB / Regular gasoline
Qty: 25,000 MT +/- 5%
Terms: CFR
Load: Antwerp, Belgium
Discharge: Barcelona, Spain
Laycan: 18-20 April 2026
No vessel nominated yet.
Price: Platts CIF NWE +$1.25/MT

Ref: ET-2026-089`,
  },

  {
    id: "dap-sale-us",
    label: "DAP Sale US — SCAC required",
    tag: "DAP · SELL",
    tagVariant: "warning",
    testFocus: "DAP US destination — SCAC code special instruction. High complexity.",
    text: `Thomas,

Confirmed sold to Trafigura Petroleum:
28,000 MT RBOB DAP Houston, Texas
Load: Amsterdam, Netherlands
Laycan: 15-17 April 2026
Price: Platts USGC pipeline +$0.50/bbl
Vessel TBC

Note: SCAC code required on Bill of Lading for US customs clearance.
EUR1 certificate NOT required (non-preferential origin).`,
  },

  {
    id: "fob-sale-ara",
    label: "FOB Sale ARA",
    tag: "FOB · SELL",
    tagVariant: "success",
    testFocus: "FOB sell — buyer arranges vessel. Simpler workflow.",
    text: `Hi,

Sold to Gunvor Group:
Product: EBOB 10ppm
Quantity: 20,000 MT
Terms: FOB
Load port: Rotterdam (Maasvlakte)
Laycan: 22-24 April 2026
Buyer nominates vessel — we accept/reject.
Price: Platts CIF NWE Cargo basis flat`,
  },

  // ── Terse / Telegram-style ───────────────────────────────────
  {
    id: "terse-telegram",
    label: "Telegram-style — terse",
    tag: "TERSE",
    tagVariant: "muted",
    testFocus: "Minimal info, no structure — tests AI inference and low-confidence scoring",
    text: `Done: sold 30kt EBOB CIF NY to Shell, laycan 5/7 Apr, vessel Arrow IMO 9786543, platts -5`,
  },

  {
    id: "chat-abbreviations",
    label: "Chat — port abbreviations",
    tag: "ABBREVS",
    tagVariant: "muted",
    testFocus: "AMS, Rdam, Kly abbreviations — tests port name normalization",
    text: `Bought 15kt reformate FOB Kly from Vitol, laycan 10-12/4, no vessel yet. Px: platts fob baltic +2.5`,
  },

  // ── Low confidence / ambiguous ───────────────────────────────
  {
    id: "ambiguous-direction",
    label: "Ambiguous — direction unclear",
    tag: "LOW CONF",
    tagVariant: "danger",
    testFocus: "Direction not stated explicitly — should flag low confidence on direction field",
    text: `Deal confirmed with BP Oil International:

25,000 MT Naphtha
Incoterm: FOB Rotterdam
Laycan first half May 2026
Price: Platts NWE Naphtha CIF +$3.00/MT

No vessel information yet.`,
  },

  {
    id: "date-ambiguity",
    label: "Ambiguous dates — word format",
    tag: "DATES",
    tagVariant: "warning",
    testFocus: "\"first half April\" and \"end of April\" — tests date range parsing",
    text: `Recap:

Sold 22,000 MT UNL95 CIF to Total Energies
Load Antwerp, discharge Singapore
Laycan: first half April 2026
Vessel: TBN
Price: Platts CIF Singapore swap +2.00

Inspector to be agreed with buyer (50/50 cost share).`,
  },

  {
    id: "missing-critical-fields",
    label: "Missing discharge port",
    tag: "INCOMPLETE",
    tagVariant: "danger",
    testFocus: "Discharge port missing — operator must fill in before creating deal",
    text: `Quick recap:

Purchase 18,000 MT RBOB from Mercuria
FOB basis, Klaipeda terminal
Laycan 8-10 April 2026
Vessel: MT Baltic Star, IMO 9502847
Price: Platts FOB Baltic +$1.75/MT`,
  },

  // ── Complex / multi-instruction ──────────────────────────────
  {
    id: "complex-with-amendments",
    label: "Complex — vessel amendment note",
    tag: "COMPLEX",
    tagVariant: "accent",
    testFocus: "Amendment language in email — tests extraction of current (not previous) vessel",
    text: `AMENDED DEAL RECAP — EG-2026-031 (supersedes v1)

Sold to Gunvor Group, CIF Rotterdam → New York:
Product: EBOB Reg
Quantity: 28,500 MT (+/- 5%)
Laycan: 12-14 April 2026 (REVISED from 10-12 Apr)
Vessel: MT Seagull Banner, IMO 9412033
  (replaces previously nominated MT Nordic Arrow)
Price: Platts CIF NWE -$4.50/MT
Discharge: NY Harbor
Load: Amsterdam, Oiltanking terminal

B/L instructions to follow from buyer.
Inspector: per buyer's nomination (cost shared).`,
  },

  {
    id: "dual-port-klaipeda",
    label: "Klaipeda load — blending note",
    tag: "KLAIPEDA",
    tagVariant: "info",
    testFocus: "Klaipeda terminal + special blending instruction",
    text: `Deal — purchase:

Counterparty: Litasco SA
Product: Naphtha (blending grade)
Qty: 12,000 MT
Terms: FOB Klaipeda
Laycan: 20-22 April 2026
Vessel: to be nominated by us within 5 days of laycan
Price: Platts CIF NWE Naphtha -$8.00/MT

Note: Blending at terminal prior to load. Inspector appointment 50/50 cost share with seller.`,
  },
];

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
// DEBUG FIXTURE PANEL
// ============================================================

function DebugPanel({ onLoad }: { onLoad: (text: string) => void }) {
  const [open, setOpen] = useState(false);

  const handleRandom = () => {
    const pick = SAMPLE_EMAILS[Math.floor(Math.random() * SAMPLE_EMAILS.length)];
    onLoad(pick.text);
    setOpen(false);
  };

  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-1)]">
      {/* Header row */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        <FlaskConical className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] flex-shrink-0" />
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">Debug fixtures</span>
        <span className="text-[0.6875rem] text-[var(--color-text-tertiary)] ml-1">
          {SAMPLE_EMAILS.length} scenarios
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); handleRandom(); }}
          className="ml-auto flex items-center gap-1 text-[0.6875rem] px-2 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-accent-text)] transition-colors"
        >
          <Shuffle className="h-3 w-3" />
          Random
        </button>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
          : <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
        }
      </button>

      {/* Fixture list */}
      {open && (
        <div className="border-t border-[var(--color-border-subtle)] divide-y divide-[var(--color-border-subtle)]">
          {SAMPLE_EMAILS.map((s) => (
            <button
              key={s.id}
              onClick={() => { onLoad(s.text); setOpen(false); }}
              className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-[var(--color-surface-2)] transition-colors text-left group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-text)] transition-colors">
                    {s.label}
                  </span>
                  <span className={`text-[0.6rem] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                    s.tagVariant === "accent" ? "bg-[var(--color-accent-muted)] text-[var(--color-accent-text)]" :
                    s.tagVariant === "info"   ? "bg-[var(--color-info-muted)] text-[var(--color-info)]" :
                    s.tagVariant === "success" ? "bg-[var(--color-success-muted)] text-[var(--color-success)]" :
                    s.tagVariant === "warning" ? "bg-[var(--color-accent-muted)] text-[var(--color-accent)]" :
                    s.tagVariant === "danger"  ? "bg-[var(--color-danger-muted,#3d1515)] text-[var(--color-danger)]" :
                    "bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)]"
                  }`}>
                    {s.tag}
                  </span>
                </div>
                <p className="text-[0.6875rem] text-[var(--color-text-tertiary)] mt-0.5 leading-relaxed">
                  {s.testFocus}
                </p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function ParseDealPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillLinkageId = searchParams.get("linkageId");
  const prefillDirection = searchParams.get("direction"); // "buy" | "sell" | null
  const [rawText, setRawText] = useState("");
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editedFields, setEditedFields] = useState<Record<string, string>>(
    prefillDirection === "buy" || prefillDirection === "sell"
      ? { direction: prefillDirection }
      : {}
  );
  const [creating, setCreating] = useState(false);

  // Duplicate detection state
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [showDupDialog, setShowDupDialog] = useState(false);
  const [dupChoice, setDupChoice] = useState<"ai" | "manual" | "new">("ai");
  const [manualLinkageCode, setManualLinkageCode] = useState("");
  const [activeLinkageCodes, setActiveLinkageCodes] = useState<string[]>([]);
  const [pendingPayload, setPendingPayload] = useState<any>(null);

  // Linkage suggestion state (auto-detect which linkage this deal belongs to)
  const [linkageSuggestions, setLinkageSuggestions] = useState<LinkageSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  // null = "Create new linkage"; string = linkageId to link to
  // If prefillLinkageId is provided (came from a linkage view's "+" menu),
  // lock this deal to that linkage from the start.
  const [selectedLinkageId, setSelectedLinkageId] = useState<string | null>(
    prefillLinkageId ?? null
  );

  // E2E: parse then immediately create and navigate — one click
  const [e2eRunning, setE2eRunning] = useState(false);
  const [e2eStatus, setE2eStatus] = useState<string | null>(null);

  const runParse = async (text: string): Promise<ParseResult | null> => {
    const res = await fetch("/api/deals/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText: text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Parsing failed");
    return data as ParseResult;
  };

  const fetchLinkageSuggestions = async (fields: Record<string, string>) => {
    // Only fetch if we have enough signal to match against
    if (
      !fields.counterparty ||
      !fields.direction ||
      !fields.product ||
      !fields.quantity_mt ||
      !fields.laycan_start ||
      !fields.laycan_end
    ) {
      setLinkageSuggestions([]);
      setSelectedLinkageId(null);
      return;
    }

    setLoadingSuggestions(true);
    try {
      const res = await fetch("/api/linkages/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterparty: fields.counterparty,
          direction: fields.direction,
          product: fields.product,
          quantityMt: Number(fields.quantity_mt),
          laycanStart: fields.laycan_start,
          laycanEnd: fields.laycan_end,
          vesselName: fields.vessel_name || null,
          loadport: fields.loadport || "",
          dischargePort: fields.discharge_port || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const suggestions: LinkageSuggestion[] = data.suggestions ?? [];
        setLinkageSuggestions(suggestions);
        // Preselect the top suggestion if any, otherwise "new linkage"
        setSelectedLinkageId(suggestions[0]?.linkageId ?? null);
      } else {
        setLinkageSuggestions([]);
        setSelectedLinkageId(null);
      }
    } catch {
      setLinkageSuggestions([]);
      setSelectedLinkageId(null);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleParse = async () => {
    if (!rawText.trim()) return;
    setParsing(true);
    setError(null);
    setResult(null);
    setEditedFields(
      prefillDirection === "buy" || prefillDirection === "sell"
        ? { direction: prefillDirection }
        : {}
    );
    setLinkageSuggestions([]);
    // Preserve prefill linkage lock across re-parse
    setSelectedLinkageId(prefillLinkageId ?? null);

    try {
      const data = await runParse(rawText);
      if (!data) return;
      setResult(data);
      const initial: Record<string, string> = {};
      for (const [k, v] of Object.entries(data.fields)) {
        initial[k] = v != null ? String(v) : "";
      }
      // If the parse came from a linkage "+ parse email" menu, force the
      // direction the operator clicked — the AI parser sometimes flips it.
      if (prefillDirection === "buy" || prefillDirection === "sell") {
        initial.direction = prefillDirection;
      }
      setEditedFields(initial);
      // If caller pre-locked the linkage, keep it locked and skip suggestions.
      if (prefillLinkageId) {
        setSelectedLinkageId(prefillLinkageId);
      } else {
        // Auto-detect linkage based on parsed fields
        fetchLinkageSuggestions(initial);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parsing failed");
    } finally {
      setParsing(false);
    }
  };

  const updateField = (key: keyof ParsedFields, val: string) => {
    setEditedFields((prev) => ({ ...prev, [key]: val }));
  };

  const buildDealPayload = (
    fields: Record<string, string>,
    source: string,
    linkageId?: string | null
  ) => ({
    counterparty: fields.counterparty || undefined,
    direction: fields.direction || undefined,
    product: fields.product || undefined,
    quantityMt: fields.quantity_mt ? Number(fields.quantity_mt) : undefined,
    contractedQty: fields.contracted_qty || null,
    incoterm: fields.incoterm || undefined,
    loadport: fields.loadport || undefined,
    dischargePort: fields.discharge_port || null,
    laycanStart: fields.laycan_start || undefined,
    laycanEnd: fields.laycan_end || undefined,
    vesselName: fields.vessel_name || null,
    vesselImo: fields.vessel_imo || null,
    pricingFormula: fields.pricing_formula || null,
    pricingPeriodType: fields.pricing_period_type || null,
    pricingPeriodValue: fields.pricing_period_value || null,
    specialInstructions: fields.special_instructions || null,
    externalRef: fields.external_ref || null,
    sourceRawText: source,
    // Auto-linkage: if linkageId is provided (non-null), backend links to it;
    // if omitted/null, backend auto-creates a TEMP linkage.
    linkageId: linkageId ?? undefined,
  });

  const submitDeal = async (payload: any) => {
    setCreating(true);
    const res = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setCreating(false);
    if (res.ok && data.id) {
      router.push(`/deals/${data.id}`);
    } else {
      setError(data.error ?? "Failed to create deal");
    }
  };

  const handleCreateDeal = async () => {
    setCreating(true);
    setError(null);
    const payload = buildDealPayload(editedFields, rawText, selectedLinkageId);

    try {
      // Check for duplicates first
      const dupRes = await fetch("/api/deals/check-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterparty: payload.counterparty ?? "",
          direction: payload.direction ?? "buy",
          product: payload.product ?? "",
          quantityMt: payload.quantityMt ?? 0,
          laycanStart: payload.laycanStart ?? "",
          loadport: payload.loadport ?? "",
          dischargePort: payload.dischargePort ?? null,
        }),
      });

      if (dupRes.ok) {
        const { duplicates: dups } = await dupRes.json();
        if (dups.length > 0) {
          setDuplicates(dups);
          setPendingPayload(payload);
          setDupChoice("ai");
          setManualLinkageCode("");
          // Fetch active linkage codes for manual selection
          fetch("/api/deals?perPage=200")
            .then((r) => r.json())
            .then((data) => {
              const codes = (data.items ?? [])
                .map((d: any) => d.linkageCode as string | null)
                .filter((c: string | null): c is string => !!c);
              setActiveLinkageCodes([...new Set(codes)] as string[]);
            })
            .catch(() => {});
          setShowDupDialog(true);
          setCreating(false);
          return;
        }
      }
    } catch {
      // If duplicate check fails, proceed with creation
    }

    await submitDeal(payload);
  };

  /** E2E: load fixture → parse → create → navigate to deal detail.
   *  When called from the Demo Tour (tourMode=true), fires a
   *  "tour:deal-created" event instead of self-navigating so the
   *  tour orchestrator can take over the navigation. */
  const handleE2E = async (fixture?: SampleEmail, tourMode = false) => {
    const sample = fixture ?? SAMPLE_EMAILS[Math.floor(Math.random() * SAMPLE_EMAILS.length)];
    setE2eRunning(true);
    setError(null);
    setE2eStatus(`Loading "${sample.label}"…`);
    setRawText(sample.text);

    try {
      setE2eStatus("Parsing…");
      const parsed = await runParse(sample.text);
      if (!parsed) throw new Error("No parse result");

      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.fields)) {
        fields[k] = v != null ? String(v) : "";
      }
      setResult(parsed);
      setEditedFields(fields);

      // In tour mode: pause so the viewer can see the parsed fields + confidence scores
      if (tourMode) {
        setE2eStatus("Review parsed fields…");
        await new Promise((res) => setTimeout(res, 8000));
      }

      // Pre-flight: check required fields before hitting the API
      const REQUIRED: Array<[string, string]> = [
        ["counterparty", "counterparty"],
        ["direction",    "buy/sell direction"],
        ["product",      "product"],
        ["quantity_mt",  "quantity"],
        ["incoterm",     "incoterm"],
        ["loadport",     "load port"],
        ["laycan_start", "laycan start date"],
        ["laycan_end",   "laycan end date"],
      ];
      const missing = REQUIRED.filter(([k]) => !fields[k]).map(([, label]) => label);
      if (missing.length > 0) {
        throw new Error(`Parser couldn't extract: ${missing.join(", ")}. Check the fixture text or edit fields manually.`);
      }

      setE2eStatus("Creating deal…");
      const createRes = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildDealPayload(fields, sample.text)),
      });
      const dealData = await createRes.json();
      if (!createRes.ok) throw new Error(dealData.error ?? "Deal creation failed");

      setE2eStatus("Done ✓");

      if (tourMode) {
        // Signal the tour orchestrator; it will handle the navigation
        window.dispatchEvent(
          new CustomEvent("tour:deal-created", { detail: { dealId: dealData.id } })
        );
      } else {
        router.push(`/deals/${dealData.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "E2E run failed");
      setE2eStatus(null);
      setE2eRunning(false);
    }
  };

  // Listen for the Demo Tour triggering an E2E run
  useEffect(() => {
    const handleTourE2E = () => {
      // Use the "CIF Sale ARA — clean" fixture for the demo — best showcase
      // Use the CFR sale fixture for the demo tour — showcases the new CFR
      // workflow template matching (round 7 addition). Falls back to CIF if missing.
      const demoFixture = SAMPLE_EMAILS.find((s) => s.id === "cfr-sale-med")
        ?? SAMPLE_EMAILS.find((s) => s.id === "cif-sale-ara-clean");
      handleE2E(demoFixture, /* tourMode */ true);
    };
    window.addEventListener("tour:run-e2e", handleTourE2E);
    return () => window.removeEventListener("tour:run-e2e", handleTourE2E);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        {/* E2E quick-run */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => handleE2E()}
            disabled={e2eRunning}
            title="Pick a random fixture, parse it, create the deal, and navigate straight to the deal detail — full E2E in one click"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent-text)] hover:bg-[var(--color-accent-muted)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {e2eRunning ? (
              <>
                <div className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                {e2eStatus ?? "Running…"}
              </>
            ) : (
              <>
                <Zap className="h-3.5 w-3.5" />
                E2E Test
              </>
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left — raw text input */}
        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Raw Email / Recap</CardTitle>
            </CardHeader>

            <FileDropZone
              onTextExtracted={(text, filename) => {
                setRawText(text);
                setUploadedFilename(filename);
                setResult(null);
                setError(null);
                setEditedFields({});
              }}
              disabled={parsing}
            />

            <div className="flex items-center gap-3 py-2">
              <div className="flex-1 border-t border-[var(--color-border-subtle)]" />
              <span className="text-xs text-[var(--color-text-tertiary)]">or paste text</span>
              <div className="flex-1 border-t border-[var(--color-border-subtle)]" />
            </div>

            {uploadedFilename && rawText && (
              <div className="flex items-center gap-1.5 pb-1">
                <span className="text-[0.625rem] font-medium text-[var(--color-accent)] uppercase tracking-wider">
                  Loaded from: {uploadedFilename}
                </span>
              </div>
            )}

            <textarea
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                if (uploadedFilename) setUploadedFilename(null);
              }}
              placeholder={`Paste the trader email or deal recap here…

Example:
Sold to Shell Trading
30,000 MT EBOB CIF New York
Load Amsterdam, Laycan 5/7 April
Vessel MT Gannet Arrow IMO 9786543
Price: Platts CIF NWE -$5/MT`}
              className="w-full h-52 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] bg-transparent border-0 outline-none resize-none font-mono leading-relaxed"
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
                  onClick={() => { setRawText(""); setUploadedFilename(null); setResult(null); setError(null); }}
                  className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </Card>

          {/* Debug fixtures */}
          <DebugPanel onLoad={(text) => { setRawText(text); setResult(null); setError(null); setEditedFields({}); }} />

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
                <p className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mb-1">Core</p>
                <FieldRow label="Counterparty"  fieldKey="counterparty"  value={editedFields.counterparty  ?? ""} score={result.confidenceScores.counterparty  ?? 0} onChange={updateField} />
                <FieldRow label="Direction"     fieldKey="direction"     value={editedFields.direction     ?? ""} score={result.confidenceScores.direction     ?? 0} onChange={updateField} type="select" options={["buy", "sell"]} />
                <FieldRow label="Product"       fieldKey="product"       value={editedFields.product       ?? ""} score={result.confidenceScores.product       ?? 0} onChange={updateField} />
                <FieldRow label="Quantity (MT)" fieldKey="quantity_mt"   value={editedFields.quantity_mt   ?? ""} score={result.confidenceScores.quantity_mt   ?? 0} onChange={updateField} type="number" />
                <FieldRow label="Contracted Qty" fieldKey="contracted_qty" value={editedFields.contracted_qty ?? ""} score={result.confidenceScores.contracted_qty ?? 0} onChange={updateField} />
                <FieldRow label="Incoterm"      fieldKey="incoterm"      value={editedFields.incoterm      ?? ""} score={result.confidenceScores.incoterm      ?? 0} onChange={updateField} type="select" options={["FOB", "CIF", "CFR", "DAP", "FCA"]} />

                <p className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mt-3 mb-1">Logistics</p>
                <FieldRow label="Loadport"      fieldKey="loadport"      value={editedFields.loadport      ?? ""} score={result.confidenceScores.loadport      ?? 0} onChange={updateField} />
                <FieldRow label="Discharge Port" fieldKey="discharge_port" value={editedFields.discharge_port ?? ""} score={result.confidenceScores.discharge_port ?? 0} onChange={updateField} />
                <FieldRow label="Laycan Start"  fieldKey="laycan_start"  value={editedFields.laycan_start  ?? ""} score={result.confidenceScores.laycan_start  ?? 0} onChange={updateField} />
                <FieldRow label="Laycan End"    fieldKey="laycan_end"    value={editedFields.laycan_end    ?? ""} score={result.confidenceScores.laycan_end    ?? 0} onChange={updateField} />

                <p className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mt-3 mb-1">Vessel</p>
                <FieldRow label="Vessel Name"   fieldKey="vessel_name"   value={editedFields.vessel_name   ?? ""} score={result.confidenceScores.vessel_name   ?? 0} onChange={updateField} />
                <FieldRow label="Vessel IMO"    fieldKey="vessel_imo"    value={editedFields.vessel_imo    ?? ""} score={result.confidenceScores.vessel_imo    ?? 0} onChange={updateField} />

                <p className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider mt-3 mb-1">Additional</p>
                <FieldRow label="Pricing Formula"   fieldKey="pricing_formula"     value={editedFields.pricing_formula     ?? ""} score={result.confidenceScores.pricing_formula     ?? 0} onChange={updateField} />
                <FieldRow label="Pricing Period"    fieldKey="pricing_period_type" value={editedFields.pricing_period_type ?? ""} score={result.confidenceScores.pricing_period_type ?? 0} onChange={updateField} type="select" options={["BL", "NOR", "Fixed", "EFP"]} />
                <FieldRow label="Period Value"      fieldKey="pricing_period_value" value={editedFields.pricing_period_value ?? ""} score={result.confidenceScores.pricing_period_value ?? 0} onChange={updateField} />
                <FieldRow label="External Ref"      fieldKey="external_ref"        value={editedFields.external_ref        ?? ""} score={result.confidenceScores.external_ref        ?? 0} onChange={updateField} />
                <FieldRow label="Special Instr."    fieldKey="special_instructions" value={editedFields.special_instructions ?? ""} score={result.confidenceScores.special_instructions ?? 0} onChange={updateField} />
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 pt-3 border-t border-[var(--color-border-subtle)] mt-3">
                <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
                  <CheckCircle2 className="h-3 w-3 text-[var(--color-success)]" />≥85% confident
                </div>
                <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
                  <AlertTriangle className="h-3 w-3 text-[var(--color-accent)]" />50–84% — review
                </div>
                <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
                  <AlertTriangle className="h-3 w-3 text-[var(--color-danger)]" />&lt;50% — fill in
                </div>
              </div>

              {/* Linkage suggestions */}
              <div className="pt-3 border-t border-[var(--color-border-subtle)] mt-3">
                <div className="flex items-center gap-2 mb-2">
                  <Link2 className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                  <p className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                    Linkage
                  </p>
                  {loadingSuggestions && (
                    <div className="h-3 w-3 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
                  )}
                </div>

                {linkageSuggestions.length > 0 ? (
                  <>
                    <p className="text-xs text-[var(--color-text-secondary)] mb-2">
                      We found existing linkages that may match:
                    </p>
                    <div className="space-y-1.5">
                      {linkageSuggestions.map((sug) => (
                        <button
                          key={sug.linkageId}
                          onClick={() => setSelectedLinkageId(sug.linkageId)}
                          className={`w-full flex items-start gap-2.5 p-2.5 rounded-[var(--radius-md)] border text-left transition-colors ${
                            selectedLinkageId === sug.linkageId
                              ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                              : "border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)]"
                          }`}
                        >
                          <span
                            className={`mt-0.5 h-3.5 w-3.5 rounded-full border flex-shrink-0 flex items-center justify-center ${
                              selectedLinkageId === sug.linkageId
                                ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                                : "border-[var(--color-border-default)]"
                            }`}
                          >
                            {selectedLinkageId === sug.linkageId && (
                              <span className="h-1.5 w-1.5 rounded-full bg-white" />
                            )}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-mono font-medium text-[var(--color-text-primary)]">
                                {sug.displayName}
                              </span>
                              <Badge variant="accent">{sug.score}% match</Badge>
                            </div>
                            {sug.deals.length > 0 && (
                              <p className="text-[0.6875rem] text-[var(--color-text-secondary)] mt-0.5">
                                {sug.deals
                                  .slice(0, 2)
                                  .map(
                                    (d) =>
                                      `${d.direction === "buy" ? "Buy from" : "Sell to"} ${d.counterparty} ${Number(
                                        d.quantityMt
                                      ).toLocaleString()} MT`
                                  )
                                  .join(" · ")}
                                {sug.deals.length > 2 && ` · +${sug.deals.length - 2} more`}
                              </p>
                            )}
                            {sug.reason && (
                              <p className="text-[0.6875rem] text-[var(--color-text-tertiary)] mt-0.5">
                                {sug.reason}
                              </p>
                            )}
                          </div>
                        </button>
                      ))}

                      {/* Create new linkage option */}
                      <button
                        onClick={() => setSelectedLinkageId(null)}
                        className={`w-full flex items-start gap-2.5 p-2.5 rounded-[var(--radius-md)] border text-left transition-colors ${
                          selectedLinkageId === null
                            ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                            : "border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)]"
                        }`}
                      >
                        <span
                          className={`mt-0.5 h-3.5 w-3.5 rounded-full border flex-shrink-0 flex items-center justify-center ${
                            selectedLinkageId === null
                              ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                              : "border-[var(--color-border-default)]"
                          }`}
                        >
                          {selectedLinkageId === null && (
                            <span className="h-1.5 w-1.5 rounded-full bg-white" />
                          )}
                        </span>
                        <div className="flex items-center gap-2">
                          <Plus className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
                          <span className="text-sm text-[var(--color-text-primary)]">
                            Create new linkage
                          </span>
                        </div>
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {loadingSuggestions
                      ? "Checking for matching linkages…"
                      : "No matching linkages found — a new TEMP linkage will be created."}
                  </p>
                )}
              </div>

              {/* Create deal button */}
              <div className="pt-3 border-t border-[var(--color-border-subtle)] mt-1 space-y-2">
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
                  <p className="text-xs text-[var(--color-text-tertiary)] text-center">
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
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">Paste a deal email</p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1 max-w-xs leading-relaxed">
                    The AI will extract counterparty, product, quantity, incoterm, ports, laycan,
                    vessel and pricing — with per-field confidence scores.
                  </p>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    Pick a fixture from the debug panel, or
                  </p>
                  <button
                    onClick={() => handleE2E()}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] text-[var(--color-accent-text)] hover:opacity-90 transition-opacity font-medium"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Run E2E Test (random fixture)
                  </button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Duplicate / linkage dialog */}
      <Dialog
        open={showDupDialog}
        onClose={() => { setShowDupDialog(false); setCreating(false); }}
        title="Potential Duplicate Found"
        description="A matching deal already exists. How would you like to proceed?"
      >
        {/* Matched deal summary */}
        <div className="space-y-2 mb-4">
          {duplicates.map((dup) => (
            <div
              key={dup.id}
              className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-warning-muted)] border border-[var(--color-warning)]"
            >
              <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] flex-shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-[var(--color-text-primary)]">{dup.counterparty}</span>
                <span className="text-[var(--color-text-secondary)]">
                  {" "}{dup.direction.toUpperCase()} {dup.product} — {Number(dup.quantityMt).toLocaleString()} MT
                </span>
                {dup.linkageCode && (
                  <span className="ml-2 text-xs font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-accent-text)]">
                    {dup.linkageCode}
                  </span>
                )}
                <span className="text-xs text-[var(--color-text-tertiary)] ml-2">
                  {dup.laycanStart}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Three options */}
        <div className="space-y-2 mb-4">
          {/* Option 1: AI suggestion — link to matched deal */}
          {duplicates.length > 0 && duplicates[0].linkageCode && (
            <button
              onClick={() => setDupChoice("ai")}
              className={`w-full flex items-start gap-3 p-3 rounded-[var(--radius-md)] border text-left transition-colors ${
                dupChoice === "ai"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                  : "border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)]"
              }`}
            >
              <Link2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-[var(--color-accent)]" />
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">
                  Link to {duplicates[0].counterparty} — {duplicates[0].linkageCode}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                  Set this deal&apos;s linkage code to match the existing deal
                </p>
              </div>
            </button>
          )}

          {/* Option 2: Manual linkage selection */}
          <button
            onClick={() => setDupChoice("manual")}
            className={`w-full flex items-start gap-3 p-3 rounded-[var(--radius-md)] border text-left transition-colors ${
              dupChoice === "manual"
                ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                : "border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)]"
            }`}
          >
            <List className="h-4 w-4 mt-0.5 flex-shrink-0 text-[var(--color-info)]" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Pick linkage manually</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Choose an existing linkage code from active deals
              </p>
              {dupChoice === "manual" && (
                <select
                  value={manualLinkageCode}
                  onChange={(e) => setManualLinkageCode(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-2 w-full h-8 px-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border-default)] rounded-[var(--radius-md)] text-[var(--color-text-primary)]"
                >
                  <option value="">Select a linkage code...</option>
                  {activeLinkageCodes.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              )}
            </div>
          </button>

          {/* Option 3: Create as new */}
          <button
            onClick={() => setDupChoice("new")}
            className={`w-full flex items-start gap-3 p-3 rounded-[var(--radius-md)] border text-left transition-colors ${
              dupChoice === "new"
                ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                : "border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)]"
            }`}
          >
            <Plus className="h-4 w-4 mt-0.5 flex-shrink-0 text-[var(--color-text-secondary)]" />
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Create as new deal</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                No linkage — this is a standalone deal
              </p>
            </div>
          </button>
        </div>

        <div className="flex gap-3">
          <Button
            variant="primary"
            disabled={dupChoice === "manual" && !manualLinkageCode}
            onClick={() => {
              setShowDupDialog(false);
              const updatedPayload = { ...pendingPayload };
              if (dupChoice === "ai" && duplicates[0]?.linkageCode) {
                updatedPayload.linkageCode = duplicates[0].linkageCode;
              } else if (dupChoice === "manual" && manualLinkageCode) {
                updatedPayload.linkageCode = manualLinkageCode;
              }
              submitDeal(updatedPayload);
            }}
          >
            {dupChoice === "new" ? "Create Deal" : "Link & Create"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => { setShowDupDialog(false); setCreating(false); }}
          >
            Cancel
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
