"use client";

/**
 * /linkages/[id] — Canonical linkage detail page.
 *
 * A linkage is a "folder" that groups related deals into a cargo chain.
 * This page renders the folder even when it's empty — the operator can
 * set the vessel, operators, notes, and linkage number before any deals
 * exist, then use the "+" buttons to add deals.
 *
 * Previously the linkage view was only reachable through /deals/[id] when
 * a deal belonged to a linkage with other deals. That broke empty linkages.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CpQaPanel } from "@/components/cp-qa-panel";
import { toast } from "sonner";
import {
  ArrowLeft,
  Pencil,
  Plus,
  Link2,
  Ship,
  Users,
  DollarSign,
  Save,
  X,
  FileText,
  Trash2,
  Upload,
  ChevronDown,
  ChevronUp,
  Anchor,
  CircleDot,
  Layers,
  Loader2,
  GripVertical,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { VoyageStrip, type VoyageStripDeal } from "./voyage-strip";
import {
  VoyageSchematicBarWrapper,
  type VoyageSchematicBarDeal,
} from "./voyage-schematic-bar-wrapper";

// ── Types ────────────────────────────────────────────────────

interface VesselTank {
  name: string;
  capacity100?: number | null;
  capacity98?: number | null;
  coating?: string | null;
}

interface VesselLoadline {
  name: string;
  freeboard?: number | null;
  draft?: number | null;
  dwt?: number | null;
  displacement?: number | null;
}

interface VesselParticulars {
  dwt?: number | null;
  loa?: number | null;
  beam?: number | null;
  summerDraft?: number | null;
  flag?: string | null;
  classSociety?: string | null;
  builtYear?: number | null;
  builder?: string | null;
  vesselType?: string | null;
  tankCount?: number | null;
  totalCargoCapacity98?: number | null;
  totalCargoCapacity100?: number | null;
  coating?: string | null;
  segregations?: number | null;
  pumpType?: string | null;
  serviceSpeedLadenKn?: number | null;
  tanks?: VesselTank[];
  loadlines?: VesselLoadline[];
  parsedAt?: string;
  sourceDocumentId?: string;
}

interface LinkageData {
  id: string;
  linkageNumber: string | null;
  tempName: string;
  status: string;
  vesselName: string | null;
  vesselImo: string | null;
  vesselMmsi: string | null;
  vesselParticulars: VesselParticulars | null;
  cpSpeedKn: string | number | null;
  cpSpeedSource: string | null;
  assignedOperatorId: string | null;
  secondaryOperatorId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DealParcelSummary {
  parcelNo: number;
  product: string;
  quantityMt: string;
  contractedQty: string | null;
}

interface DealSummary {
  id: string;
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
  status: string;
  dealType: string;
  vesselName: string | null;
  sortOrder: number;
  /** Voyage-timeline fields. arrivalAt is the operator-entered ETA/ATA at
   *  this deal's port; arrivalIsActual flips ETA → ATA semantically.
   *  departureOverride pins ETS manually instead of qty-driven auto-calc. */
  arrivalAt: string | null;
  arrivalIsActual: boolean;
  departureOverride: string | null;
  /** Optimistic-locking version, threaded into voyage-strip PUT payloads. */
  version: number;
  /** 1 for single-parcel (the common case), 2+ for multi-grade deals. */
  parcelCount?: number;
  /**
   * Per-parcel detail. Server only attaches this when parcelCount > 1 to
   * keep the dashboard payload small for the dominant single-parcel case.
   * Single-parcel deals' grade lives in `product` / `quantityMt` directly.
   */
  parcels?: DealParcelSummary[];
}

interface WorkflowStep {
  id: string;
  stepName: string;
  status: string;
  stepType: string;
  recipientPartyType: string | null;
}

interface LinkageStepData {
  id: string;
  stepName: string;
  stepType: string;
  status: string;
  recipientPartyType: string | null;
  description: string | null;
  sentAt: string | null;
}

interface LinkageDoc {
  id: string;
  filename: string;
  fileType: string;
  storagePath: string | null;
  createdAt: string;
}

// Adapter: dashboard's DealSummary → voyage-strip input shape. Keeps the
// VoyageStrip prop contract narrow (only the fields it actually reads) and
// quietly drops anything the strip doesn't care about.
function toVoyageStripDeal(d: DealSummary): VoyageStripDeal {
  return {
    id: d.id,
    direction: d.direction === "buy" ? "buy" : "sell",
    loadport: d.loadport,
    dischargePort: d.dischargePort,
    quantityMt: d.quantityMt,
    arrivalAt: d.arrivalAt ?? null,
    arrivalIsActual: d.arrivalIsActual ?? false,
    departureOverride: d.departureOverride ?? null,
    version: d.version ?? 1,
  };
}

// Adapter for the schematic bar — needs product + laycan window in addition
// to the timeline events so the header can render "5,000 MT EBOB · LAYCAN
// 23–27 APR" without an extra fetch.
function toVoyageSchematicBarDeal(d: DealSummary): VoyageSchematicBarDeal {
  return {
    id: d.id,
    direction: d.direction === "buy" ? "buy" : "sell",
    loadport: d.loadport,
    dischargePort: d.dischargePort,
    product: d.product,
    quantityMt: d.quantityMt,
    laycanStart: d.laycanStart,
    laycanEnd: d.laycanEnd,
    arrivalAt: d.arrivalAt ?? null,
    arrivalIsActual: d.arrivalIsActual ?? false,
    departureOverride: d.departureOverride ?? null,
  };
}

// ── Page ─────────────────────────────────────────────────────

export default function LinkageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const isOperator = session?.user?.role === "operator" || session?.user?.role === "admin";

  const [linkage, setLinkage] = useState<LinkageData | null>(null);
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [workflows, setWorkflows] = useState<Record<string, WorkflowStep[]>>({});
  const [linkageSteps, setLinkageSteps] = useState<LinkageStepData[]>([]);
  const [linkageDocs, setLinkageDocs] = useState<LinkageDoc[]>([]);
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    const t = Date.now();
    Promise.all([
      fetch(`/api/linkages/${id}?_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/deals?linkageId=${id}&perPage=50&_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : { items: [] }
      ),
      fetch(`/api/linkages/${id}/steps?_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : { steps: [] }
      ),
      fetch(`/api/linkages/${id}/documents?_t=${t}`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : { documents: [] }
      ),
    ])
      .then(async ([linkageData, dealsData, stepsData, docsData]) => {
        setLinkage(linkageData);
        const dealItems: DealSummary[] = dealsData.items ?? [];
        setDeals(dealItems);
        setLinkageSteps(stepsData.steps ?? []);
        setLinkageDocs(docsData.documents ?? []);

        // Fetch workflows for all deals in parallel
        const wfEntries = await Promise.all(
          dealItems.map(async (d) => {
            try {
              const res = await fetch(`/api/deals/${d.id}/workflow?_t=${t}`, { cache: "no-store" });
              if (!res.ok) return [d.id, []] as const;
              const data = await res.json();
              return [d.id, data.workflow?.steps ?? []] as const;
            } catch {
              return [d.id, []] as const;
            }
          })
        );
        setWorkflows(Object.fromEntries(wfEntries));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!isOperator) return;
    fetch("/api/users?role=operator")
      .then((r) => r.json())
      .then((data) => setOperators(data.users ?? []))
      .catch(() => {});
  }, [isOperator]);

  // Auto-refetch on visibility change + deal-added event from AddDealMenu
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    const onDealAdded = () => fetchData();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("linkage:deal-added", onDealAdded);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("linkage:deal-added", onDealAdded);
    };
  }, [fetchData]);

  // ── Drag & drop reorder state (must be before early returns) ──
  const [dragSide, setDragSide] = useState<"buy" | "sell" | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!linkage) {
    return (
      <div className="text-center py-16 text-[var(--color-text-secondary)]">
        Linkage not found
      </div>
    );
  }

  const displayName = linkage.linkageNumber ?? linkage.tempName;
  const buyDeals = deals.filter((d) => d.direction === "buy").sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const sellDeals = deals.filter((d) => d.direction === "sell").sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const buyTotal = buyDeals.reduce((s, d) => s + parseFloat(d.quantityMt || "0"), 0);
  const sellTotal = sellDeals.reduce((s, d) => s + parseFloat(d.quantityMt || "0"), 0);

  const handleDragStart = (side: "buy" | "sell", idx: number) => {
    setDragSide(side);
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setOverIdx(idx);
  };

  const handleDragEnd = () => {
    setDragSide(null);
    setDragIdx(null);
    setOverIdx(null);
  };

  const handleDrop = async (side: "buy" | "sell", dropIdx: number) => {
    if (dragSide !== side || dragIdx === null || dragIdx === dropIdx) {
      handleDragEnd();
      return;
    }
    const list = side === "buy" ? [...buyDeals] : [...sellDeals];
    const [moved] = list.splice(dragIdx, 1);
    list.splice(dropIdx, 0, moved);
    handleDragEnd();

    // Optimistic update: reorder in local state
    const reorderedIds = list.map((d) => d.id);
    const updatedDeals = deals.map((d) => {
      const idx = reorderedIds.indexOf(d.id);
      if (idx !== -1) return { ...d, sortOrder: idx };
      return d;
    });
    setDeals(updatedDeals);

    // Persist to backend
    try {
      await fetch("/api/deals/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealIds: reorderedIds }),
      });
    } catch {
      toast.error("Failed to save order");
      fetchData();
    }
  };

  return (
    <div className="max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
              Linkage
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
              {deals.length} deal{deals.length !== 1 ? "s" : ""}
              {deals.length === 0 && " — empty folder, use + to add deals"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isOperator && (
            <DeleteLinkageButton linkageId={linkage.id} dealCount={deals.length} onDeleted={() => router.push("/dashboard")} />
          )}
        </div>
      </div>

      {/* Voyage Info Bar */}
      <VoyageBar
        linkage={linkage}
        operators={operators}
        canEdit={isOperator}
        onUpdated={fetchData}
      />

      {/* Voyage schematic bar (presentation; auto-derived state) +
          Voyage timeline strip (compact data-entry table). Both surface
          the same arrival/departure events. */}
      {(buyDeals.length > 0 || sellDeals.length > 0) && (
        <>
          <VoyageSchematicBarWrapper
            linkageId={linkage.id}
            linkageNumber={linkage.linkageNumber}
            linkageTempName={linkage.tempName}
            linkageStatus={linkage.status}
            vesselName={linkage.vesselName}
            cpSpeedKn={linkage.cpSpeedKn}
            cpSpeedSource={linkage.cpSpeedSource}
            vesselParticulars={linkage.vesselParticulars}
            buyDeals={buyDeals.map(toVoyageSchematicBarDeal)}
            sellDeals={sellDeals.map(toVoyageSchematicBarDeal)}
            canEdit={isOperator}
            onUpdated={fetchData}
          />
          <VoyageStrip
            linkageId={linkage.id}
            cpSpeedKn={linkage.cpSpeedKn}
            cpSpeedSource={linkage.cpSpeedSource}
            vesselParticulars={linkage.vesselParticulars}
            buyDeals={buyDeals.map(toVoyageStripDeal)}
            sellDeals={sellDeals.map(toVoyageStripDeal)}
            canEdit={isOperator}
            onUpdated={fetchData}
          />
        </>
      )}

      {/* Notes */}
      <NotesSection
        linkageId={linkage.id}
        notes={linkage.notes}
        canEdit={isOperator}
        onSaved={fetchData}
      />

      {/* Qty summary */}
      {deals.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] text-xs font-mono">
          <span className="text-[var(--color-info)]">Buy: {buyTotal.toLocaleString()} MT</span>
          <span className="text-[var(--color-border-subtle)]">|</span>
          <span className="text-[var(--color-accent-text)]">Sell: {sellTotal.toLocaleString()} MT</span>
          <span className="text-[var(--color-border-subtle)]">|</span>
          <span className="text-[var(--color-text-secondary)]">
            Balance: ~{Math.abs(buyTotal - sellTotal).toLocaleString()} MT
          </span>
          <span className="flex-1" />
        </div>
      )}

      {/* Vessel section */}
      <VesselSection
        linkage={linkage}
        steps={linkageSteps}
        docs={linkageDocs}
        canEdit={isOperator}
        onUpdated={fetchData}
      />

      {/* Two-column grid: Buy + Sell */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Buy side */}
        <div className="space-y-3 pl-5">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-2 -ml-5">
            <span className="h-2 w-2 rounded-full bg-blue-500/60" />
            Purchase / Load
            <span className="text-xs font-normal text-[var(--color-text-tertiary)] ml-1">
              ({buyDeals.length})
            </span>
          </h2>
          {buyDeals.length === 0 ? (
            isOperator ? (
              <AddDealMenu linkageId={linkage.id} linkageCode={displayName} variant="placeholder" side="buy" siblingDeals={sellDeals} />
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] py-8 text-center">
                <p className="text-sm text-[var(--color-text-tertiary)]">No purchases yet</p>
              </div>
            )
          ) : (
            <>
              {buyDeals.map((d, i) => (
                <div
                  key={d.id}
                  draggable={isOperator && buyDeals.length > 1}
                  onDragStart={() => handleDragStart("buy", i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  onDrop={() => handleDrop("buy", i)}
                  className={`relative transition-opacity ${
                    dragSide === "buy" && dragIdx === i ? "opacity-40" : ""
                  } ${dragSide === "buy" && overIdx === i && dragIdx !== i ? "ring-2 ring-blue-500/40 rounded-[var(--radius-md)]" : ""}`}
                >
                  {isOperator && buyDeals.length > 1 && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5 cursor-grab active:cursor-grabbing text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
                      <GripVertical className="h-4 w-4" />
                    </div>
                  )}
                  <DealCard deal={d} steps={workflows[d.id] ?? []} onDeleted={fetchData} canDelete={isOperator} />
                </div>
              ))}
              {isOperator && (
                <AddDealMenu linkageId={linkage.id} linkageCode={displayName} variant="compact" side="buy" siblingDeals={sellDeals} />
              )}
            </>
          )}
        </div>

        {/* Sell side */}
        <div className="space-y-3 pl-5">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-2 -ml-5">
            <span className="h-2 w-2 rounded-full bg-amber-500/60" />
            Sale / Discharge
            <span className="text-xs font-normal text-[var(--color-text-tertiary)] ml-1">
              ({sellDeals.length})
            </span>
          </h2>
          {sellDeals.length === 0 ? (
            isOperator ? (
              <AddDealMenu linkageId={linkage.id} linkageCode={displayName} variant="placeholder" side="sell" siblingDeals={buyDeals} />
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] py-8 text-center">
                <p className="text-sm text-[var(--color-text-tertiary)]">No sales yet</p>
              </div>
            )
          ) : (
            <>
              {sellDeals.map((d, i) => (
                <div
                  key={d.id}
                  draggable={isOperator && sellDeals.length > 1}
                  onDragStart={() => handleDragStart("sell", i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  onDrop={() => handleDrop("sell", i)}
                  className={`relative transition-opacity ${
                    dragSide === "sell" && dragIdx === i ? "opacity-40" : ""
                  } ${dragSide === "sell" && overIdx === i && dragIdx !== i ? "ring-2 ring-amber-500/40 rounded-[var(--radius-md)]" : ""}`}
                >
                  {isOperator && sellDeals.length > 1 && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5 cursor-grab active:cursor-grabbing text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
                      <GripVertical className="h-4 w-4" />
                    </div>
                  )}
                  <DealCard deal={d} steps={workflows[d.id] ?? []} onDeleted={fetchData} canDelete={isOperator} />
                </div>
              ))}
              {isOperator && (
                <AddDealMenu linkageId={linkage.id} linkageCode={displayName} variant="compact" side="sell" siblingDeals={buyDeals} />
              )}
            </>
          )}
        </div>
      </div>

    </div>
  );
}

// ── Voyage Bar ───────────────────────────────────────────────

function VoyageBar({ linkage, operators, canEdit, onUpdated }: {
  linkage: LinkageData;
  operators: Array<{ id: string; name: string }>;
  canEdit: boolean;
  onUpdated: () => void;
}) {
  const displayName = linkage.linkageNumber ?? linkage.tempName;

  // Linkage number editor
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [savingName, setSavingName] = useState(false);

  // Vessel editor
  const [editingVessel, setEditingVessel] = useState(false);
  const [vesselDraft, setVesselDraft] = useState(linkage.vesselName ?? "");
  const [imoDraft, setImoDraft] = useState(linkage.vesselImo ?? "");
  const [mmsiDraft, setMmsiDraft] = useState(linkage.vesselMmsi ?? "");
  const [savingVessel, setSavingVessel] = useState(false);

  // Operator editor
  const [editingOps, setEditingOps] = useState(false);
  const [primaryDraft, setPrimaryDraft] = useState(linkage.assignedOperatorId ?? "");
  const [secondaryDraft, setSecondaryDraft] = useState(linkage.secondaryOperatorId ?? "");
  const [savingOps, setSavingOps] = useState(false);

  const saveName = async () => {
    if (!nameDraft.trim()) { toast.error("Linkage number cannot be empty"); return; }
    setSavingName(true);
    const res = await fetch(`/api/linkages/${linkage.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkageNumber: nameDraft.trim() }),
    });
    setSavingName(false);
    if (res.ok) { toast.success("Linkage number updated"); setEditingName(false); onUpdated(); }
    else toast.error("Failed to update");
  };

  const saveVessel = async () => {
    // Belt-and-braces MMSI check — worker already filters invalid MMSIs
    // at runtime, but rejecting here too gives instant feedback instead
    // of a silent drop later.
    const mmsiTrimmed = mmsiDraft.trim();
    if (mmsiTrimmed.length > 0 && !/^\d{9}$/.test(mmsiTrimmed)) {
      toast.error("MMSI must be exactly 9 digits (or leave blank)");
      return;
    }
    setSavingVessel(true);
    const res = await fetch(`/api/linkages/${linkage.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vesselName: vesselDraft.trim() || null,
        vesselImo: imoDraft.trim() || null,
        vesselMmsi: mmsiTrimmed || null,
      }),
    });
    setSavingVessel(false);
    if (res.ok) { toast.success("Vessel updated"); setEditingVessel(false); onUpdated(); }
    else toast.error("Failed to update");
  };

  const saveOps = async () => {
    setSavingOps(true);
    const res = await fetch(`/api/linkages/${linkage.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assignedOperatorId: primaryDraft || null,
        secondaryOperatorId: secondaryDraft || null,
      }),
    });
    setSavingOps(false);
    if (res.ok) { toast.success("Operators updated"); setEditingOps(false); onUpdated(); }
    else toast.error("Failed to update operators");
  };

  const operatorInitials = (opId: string | null) => {
    if (!opId) return null;
    const user = operators.find((u) => u.id === opId);
    if (user?.name) return user.name.split(/\s+/).map((n) => n[0]?.toUpperCase() ?? "").join("").slice(0, 2);
    return opId.substring(0, 2).toUpperCase();
  };

  return (
    <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-default)] border-b-2 border-b-[var(--color-border-default)]">
      <div className="flex items-center gap-5 px-5 py-3 flex-wrap">
        {/* Linkage number */}
        {editingName ? (
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-[var(--color-accent)]" />
            <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} disabled={savingName} autoFocus
              className="w-40 rounded-[var(--radius-sm)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-2 py-1 text-base font-mono font-bold text-[var(--color-text-primary)]" />
            <button onClick={saveName} disabled={savingName} className="p-1 text-[var(--color-success)] hover:bg-[var(--color-surface-3)] rounded cursor-pointer disabled:opacity-50">
              {savingName ? <div className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => setEditingName(false)} disabled={savingName} className="p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-3)] rounded cursor-pointer disabled:opacity-50">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button onClick={canEdit ? () => { setNameDraft(displayName); setEditingName(true); } : undefined} disabled={!canEdit}
            className={`flex items-center gap-2 ${canEdit ? "cursor-pointer hover:bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] px-2 py-1 -mx-2 -my-1 transition-colors" : "cursor-default"}`}
            title={canEdit ? "Click to edit linkage number" : undefined}>
            <Link2 className="h-4 w-4 text-[var(--color-accent)]" />
            <span className="text-lg font-bold font-mono text-[var(--color-text-primary)] tracking-wide">{displayName}</span>
            {canEdit && <Pencil className="h-3 w-3 text-[var(--color-text-tertiary)] opacity-60" />}
          </button>
        )}

        <div className="h-5 w-px bg-[var(--color-border-subtle)]" />

        {/* Vessel */}
        {editingVessel ? (
          <div className="flex items-center gap-2 flex-1 min-w-[280px] max-w-md">
            <Ship className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
            <input placeholder="Vessel name" value={vesselDraft} onChange={(e) => setVesselDraft(e.target.value)} disabled={savingVessel}
              className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-2 py-1 text-sm text-[var(--color-text-primary)]" />
            <input placeholder="IMO" value={imoDraft}
              onChange={(e) => setImoDraft(e.target.value.replace(/\D/g, "").slice(0, 7))}
              inputMode="numeric" pattern="[0-9]*" maxLength={7} disabled={savingVessel}
              className="w-24 rounded-[var(--radius-sm)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-2 py-1 text-xs font-mono text-[var(--color-text-primary)]" />
            <input placeholder="MMSI" value={mmsiDraft}
              onChange={(e) => setMmsiDraft(e.target.value.replace(/\D/g, "").slice(0, 9))}
              inputMode="numeric" pattern="[0-9]*" maxLength={9} disabled={savingVessel}
              title="9-digit AIS identifier — enables live position tracking"
              className="w-28 rounded-[var(--radius-sm)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-2 py-1 text-xs font-mono text-[var(--color-text-primary)]" />
            <button onClick={saveVessel} disabled={savingVessel} className="p-1 text-[var(--color-success)] hover:bg-[var(--color-surface-3)] rounded cursor-pointer disabled:opacity-50">
              {savingVessel ? <div className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => setEditingVessel(false)} disabled={savingVessel} className="p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-3)] rounded cursor-pointer disabled:opacity-50">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button onClick={canEdit ? () => { setVesselDraft(linkage.vesselName ?? ""); setImoDraft(linkage.vesselImo ?? ""); setMmsiDraft(linkage.vesselMmsi ?? ""); setEditingVessel(true); } : undefined} disabled={!canEdit}
            className={`flex items-center gap-2 ${canEdit ? "cursor-pointer hover:bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] px-2 py-1 -mx-2 -my-1 transition-colors" : "cursor-default"}`}
            title={canEdit ? "Click to edit vessel" : undefined}>
            <Ship className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">{linkage.vesselName || "TBN"}</span>
            {linkage.vesselImo && <span className="text-xs font-mono text-[var(--color-text-tertiary)] ml-1">IMO {linkage.vesselImo}</span>}
            {linkage.vesselMmsi && <span className="text-xs font-mono text-sky-400 ml-1">MMSI {linkage.vesselMmsi}</span>}
            {canEdit && <Pencil className="h-3 w-3 text-[var(--color-text-tertiary)] opacity-60" />}
          </button>
        )}

        <div className="h-5 w-px bg-[var(--color-border-subtle)]" />

        {/* Operators */}
        {editingOps ? (
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[0.625rem] text-[var(--color-text-tertiary)] w-16">Primary:</span>
                <select value={primaryDraft} onChange={(e) => setPrimaryDraft(e.target.value)} disabled={savingOps}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-2 py-1 text-xs text-[var(--color-text-primary)] min-w-[140px]">
                  <option value="">— None —</option>
                  {operators.map((op) => <option key={op.id} value={op.id}>{op.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[0.625rem] text-[var(--color-text-tertiary)] w-16">Secondary:</span>
                <select value={secondaryDraft} onChange={(e) => setSecondaryDraft(e.target.value)} disabled={savingOps}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-2 py-1 text-xs text-[var(--color-text-primary)] min-w-[140px]">
                  <option value="">— None —</option>
                  {operators.map((op) => <option key={op.id} value={op.id}>{op.name}</option>)}
                </select>
              </div>
            </div>
            <button onClick={saveOps} disabled={savingOps} className="p-1 text-[var(--color-success)] hover:bg-[var(--color-surface-3)] rounded cursor-pointer disabled:opacity-50">
              {savingOps ? <div className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => setEditingOps(false)} disabled={savingOps} className="p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-3)] rounded cursor-pointer disabled:opacity-50">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button onClick={canEdit ? () => { setPrimaryDraft(linkage.assignedOperatorId ?? ""); setSecondaryDraft(linkage.secondaryOperatorId ?? ""); setEditingOps(true); } : undefined} disabled={!canEdit}
            className={`flex items-center gap-1.5 ${canEdit ? "cursor-pointer hover:bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] px-2 py-1 -mx-2 -my-1 transition-colors" : "cursor-default"}`}
            title={canEdit ? "Click to assign operators" : undefined}>
            <Users className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
            {linkage.assignedOperatorId && (
              <span className="h-6 w-6 rounded-full bg-[var(--color-accent)] text-[var(--color-text-inverse)] text-[0.625rem] font-bold flex items-center justify-center">
                {operatorInitials(linkage.assignedOperatorId)}
              </span>
            )}
            {linkage.secondaryOperatorId && (
              <span className="h-6 w-6 rounded-full bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] text-[0.625rem] font-bold flex items-center justify-center border border-[var(--color-border-subtle)]">
                {operatorInitials(linkage.secondaryOperatorId)}
              </span>
            )}
            {!linkage.assignedOperatorId && !linkage.secondaryOperatorId && (
              <span className="text-xs text-[var(--color-text-tertiary)]">Unassigned</span>
            )}
            {canEdit && <Pencil className="h-3 w-3 text-[var(--color-text-tertiary)] opacity-60" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Notes Section ────────────────────────────────────────────

function NotesSection({ linkageId, notes, canEdit, onSaved }: {
  linkageId: string; notes: string | null; canEdit: boolean; onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(!!notes);
  const [draft, setDraft] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (draft === (notes ?? "")) return;
    setSaving(true);
    const res = await fetch(`/api/linkages/${linkageId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: draft.trim() || null }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else toast.error("Failed to save notes");
  };

  if (!expanded && !notes) {
    return canEdit ? (
      <button onClick={() => setExpanded(true)} className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer">
        <FileText className="h-3 w-3" /> Add notes
      </button>
    ) : null;
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-2.5">
      <div className="flex items-center gap-1.5 mb-1 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <FileText className="h-3 w-3 text-[var(--color-text-tertiary)]" />
        <span className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">Notes</span>
        {!expanded && notes && <span className="text-xs text-[var(--color-text-secondary)] ml-1 truncate max-w-md">{notes.split("\n")[0]}</span>}
      </div>
      {expanded && (canEdit ? (
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} disabled={saving}
          placeholder="Add notes about this voyage..." rows={3}
          className="w-full bg-transparent text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] outline-none resize-y min-h-[60px] disabled:opacity-60" />
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">{notes || "No notes"}</p>
      ))}
    </div>
  );
}

// ── Vessel Section ──────────────────────────────────────────

function VesselSection({ linkage, steps, docs, canEdit, onUpdated }: {
  linkage: LinkageData;
  steps: LinkageStepData[];
  docs: LinkageDoc[];
  canEdit: boolean;
  onUpdated: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [dragOverCp, setDragOverCp] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingCp, setUploadingCp] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<null | {
    docId: string;
    vesselName: string | null;
    vesselImo: string | null;
    vesselMmsi: string | null;
    particulars: VesselParticulars;
    confidenceScores: Record<string, number>;
  }>(null);
  const [showPlanner, setShowPlanner] = useState(false);
  const [addingStep, setAddingStep] = useState(false);
  const [newStepName, setNewStepName] = useState("");

  const vesselDisplay = linkage.vesselName || "TBN";
  const imoDisplay = linkage.vesselImo || "—";
  const hasVessel = Boolean(linkage.vesselName);
  const q88Docs = docs.filter((d) => d.fileType === "q88");
  const cpDocs = docs.filter((d) => d.fileType === "cp_recap");
  const doneCount = steps.filter((s) => s.status === "sent" || s.status === "done").length;

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    setUploading(true);
    const failed: string[] = [];
    let lastDocId: string | null = null;
    let lastFileName: string | null = null;
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("fileType", "q88");
        const res = await fetch(`/api/linkages/${linkage.id}/documents`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          failed.push(file.name);
        } else {
          const data = await res.json();
          lastDocId = data?.document?.id ?? null;
          lastFileName = file.name;
        }
      } catch {
        failed.push(file.name);
      }
    }
    setUploading(false);
    if (failed.length === 0) {
      toast.success(`Q88 uploaded: ${files.map((f) => f.name).join(", ")}`);
    } else {
      toast.error(`Upload failed: ${failed.join(", ")}`);
    }
    onUpdated();

    // Auto-parse the most recently uploaded Q88 — background job, non-blocking
    // from the operator's POV. They get a toast if it fails; on success the
    // confirm modal opens so they can review + accept.
    if (lastDocId && lastFileName) {
      void runQ88Parse(lastDocId, lastFileName);
    }
  };

  const runQ88Parse = async (docId: string, filename: string) => {
    setParsing(true);
    try {
      const res = await fetch(
        `/api/linkages/${linkage.id}/documents/${docId}/parse-q88`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Q88 parse failed: ${data.error ?? "unknown error"}`);
        return;
      }
      setParseResult({
        docId,
        vesselName: data.vesselName ?? null,
        vesselImo: data.vesselImo ?? null,
        vesselMmsi: data.vesselMmsi ?? null,
        particulars: data.particulars ?? {},
        confidenceScores: data.confidenceScores ?? {},
      });
      toast.success(`Parsed ${filename} — review and confirm`);
    } catch (err) {
      toast.error(`Q88 parse failed: ${err instanceof Error ? err.message : "network error"}`);
    } finally {
      setParsing(false);
    }
  };

  const applyParseResult = async (accept: {
    vesselName: boolean;
    vesselImo: boolean;
    vesselMmsi: boolean;
    particulars: boolean;
  }) => {
    if (!parseResult) return;
    const payload: Record<string, unknown> = {};
    if (accept.vesselName && parseResult.vesselName) payload.vesselName = parseResult.vesselName;
    if (accept.vesselImo && parseResult.vesselImo) payload.vesselImo = parseResult.vesselImo;
    if (accept.vesselMmsi && parseResult.vesselMmsi) payload.vesselMmsi = parseResult.vesselMmsi;
    if (accept.particulars) payload.vesselParticulars = parseResult.particulars;

    if (Object.keys(payload).length === 0) {
      setParseResult(null);
      return;
    }

    try {
      const res = await fetch(`/api/linkages/${linkage.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success("Vessel details applied");
        setParseResult(null);
        onUpdated();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(`Apply failed: ${data.error ?? res.statusText}`);
      }
    } catch {
      toast.error("Apply failed: network error");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDropCp = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCp(false);
    if (!canEdit) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    setUploadingCp(true);
    const failed: string[] = [];
    // Q88s auto-imported from email attachments — collected across all files
    // so we can trigger parse on the first one once uploads finish.
    const autoImportedQ88s: Array<{ id: string; filename: string }> = [];

    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("fileType", "cp_recap");
        const res = await fetch(`/api/linkages/${linkage.id}/documents`, {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          failed.push(file.name);
          continue;
        }

        // The route returns `{ document, autoImported: [{ document, classification }] }`
        // where autoImported lists any attachments extracted from a .eml drop.
        // We only auto-trigger parse for Q88 attachments — other classifications
        // (BL, COA, other) get persisted but don't have a parse pipeline yet.
        const body = await res.json().catch(() => null);
        const imported = (body?.autoImported ?? []) as Array<{
          document: { id: string; filename: string };
          classification: string;
        }>;
        for (const ai of imported) {
          if (ai.classification === "q88") {
            autoImportedQ88s.push({
              id: ai.document.id,
              filename: ai.document.filename,
            });
          }
        }
      } catch {
        failed.push(file.name);
      }
    }
    setUploadingCp(false);
    if (failed.length === 0) {
      toast.success(`CP Recap uploaded: ${files.map((f) => f.name).join(", ")}`);
    } else {
      toast.error(`Upload failed: ${failed.join(", ")}`);
    }
    onUpdated();

    // If the email(s) carried Q88 attachment(s), surface what was extracted
    // and kick off Q88 parsing on the first one. The modal flow inside
    // runQ88Parse handles the operator confirm step. Additional Q88s sit
    // as uploaded documents that the operator can parse manually.
    if (autoImportedQ88s.length > 0) {
      const names = autoImportedQ88s.map((q) => q.filename).join(", ");
      const suffix =
        autoImportedQ88s.length === 1
          ? `Q88 attachment auto-imported: ${names}`
          : `${autoImportedQ88s.length} Q88 attachments auto-imported: ${names}`;
      toast.success(suffix);
      const first = autoImportedQ88s[0];
      void runQ88Parse(first.id, first.filename);
    }
  };

  const handleDeleteDoc = async (docId: string, filename: string) => {
    if (!canEdit) return;
    if (!window.confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/linkages/${linkage.id}/documents/${docId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Document deleted");
        onUpdated();
      } else {
        toast.error("Failed to delete document");
      }
    } catch {
      toast.error("Failed to delete document");
    }
  };

  const handleAddStep = async () => {
    if (!newStepName.trim()) return;
    setAddingStep(true);
    try {
      const res = await fetch(`/api/linkages/${linkage.id}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepName: newStepName.trim(), stepType: "custom" }),
      });
      if (res.ok) {
        toast.success("Step added");
        setNewStepName("");
        onUpdated();
      } else {
        toast.error("Failed to add step");
      }
    } catch {
      toast.error("Failed to add step");
    }
    setAddingStep(false);
  };

  const handleStepStatusChange = async (stepId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/linkages/${linkage.id}/steps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, status: newStatus }),
      });
      if (res.ok) onUpdated();
      else toast.error("Failed to update step");
    } catch {
      toast.error("Failed to update step");
    }
  };

  return (
    <Card className="border-l-[3px] border-l-cyan-500/60">
      {/* Header — clickable to expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--color-surface-2)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <Anchor className="h-4 w-4 text-cyan-400" />
          <div className="text-left">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              {vesselDisplay}
            </span>
            <span className="text-xs text-[var(--color-text-tertiary)] ml-2">
              IMO {imoDisplay}
            </span>
          </div>
          {linkage.vesselParticulars?.tanks && linkage.vesselParticulars.tanks.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setShowPlanner(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  setShowPlanner(true);
                }
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-sm)] text-[0.65rem] font-medium bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 border border-cyan-500/30 transition-colors cursor-pointer"
              title="Open stowage planner"
            >
              <Layers className="h-3 w-3" />
              Planner Mode
            </span>
          )}
          {parsing && (
            <span className="inline-flex items-center gap-1 text-[0.65rem] text-[var(--color-text-tertiary)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Parsing Q88…
            </span>
          )}
          {q88Docs.length > 0 && (
            <Badge variant="muted" className="text-[0.6rem]">Q88 ✓</Badge>
          )}
          {cpDocs.length > 0 && (
            <Badge variant="muted" className="text-[0.6rem]">CP Recap ✓</Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          {steps.length > 0 && (
            <span className="text-[0.65rem] text-[var(--color-text-tertiary)]">
              {doneCount}/{steps.length} steps
            </span>
          )}
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" /> : <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--color-border-subtle)]">
          {/* Vessel details */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)] pt-3">
            <div><span className="text-[var(--color-text-tertiary)]">Vessel:</span> {vesselDisplay}</div>
            <div><span className="text-[var(--color-text-tertiary)]">IMO:</span> {imoDisplay}</div>
          </div>

          {/* Q88 drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={() => setDragOver(false)}
            className={`rounded-[var(--radius-md)] border-2 border-dashed py-3 px-4 text-center transition-colors ${
              dragOver
                ? "border-cyan-400 bg-cyan-400/5"
                : "border-[var(--color-border-subtle)] hover:border-[var(--color-border-default)]"
            }`}
          >
            {uploading ? (
              <div className="flex items-center justify-center gap-2 text-xs text-[var(--color-text-tertiary)]">
                <div className="h-3 w-3 rounded-full border border-current border-t-transparent animate-spin" />
                Uploading...
              </div>
            ) : q88Docs.length > 0 ? (
              <div className="space-y-1">
                {q88Docs.map((d) => (
                  <div key={d.id} className="flex items-center justify-center gap-2 text-xs text-cyan-400">
                    <FileText className="h-3 w-3" />
                    {d.storagePath ? (
                      <a
                        href={d.storagePath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {d.filename}
                      </a>
                    ) : (
                      <span>{d.filename}</span>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={(ev) => { ev.stopPropagation(); handleDeleteDoc(d.id, d.filename); }}
                        className="text-[var(--color-text-tertiary)] hover:text-red-400 transition-colors"
                        title="Delete document"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <p className="text-[0.65rem] text-[var(--color-text-tertiary)]">Drop to add another Q88</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <Upload className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                <p className="text-xs text-[var(--color-text-tertiary)]">Drop Q88 here</p>
              </div>
            )}
          </div>

          {/* CP Recap drop zone */}
          <div
            onDrop={handleDropCp}
            onDragOver={(e) => { e.preventDefault(); setDragOverCp(true); }}
            onDragLeave={() => setDragOverCp(false)}
            className={`rounded-[var(--radius-md)] border-2 border-dashed py-3 px-4 text-center transition-colors ${
              dragOverCp
                ? "border-amber-400 bg-amber-400/5"
                : "border-[var(--color-border-subtle)] hover:border-[var(--color-border-default)]"
            }`}
          >
            {uploadingCp ? (
              <div className="flex items-center justify-center gap-2 text-xs text-[var(--color-text-tertiary)]">
                <div className="h-3 w-3 rounded-full border border-current border-t-transparent animate-spin" />
                Uploading...
              </div>
            ) : cpDocs.length > 0 ? (
              <div className="space-y-1">
                {cpDocs.map((d) => (
                  <div key={d.id} className="flex items-center justify-center gap-2 text-xs text-amber-400">
                    <FileText className="h-3 w-3" />
                    {d.storagePath ? (
                      <a
                        href={d.storagePath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {d.filename}
                      </a>
                    ) : (
                      <span>{d.filename}</span>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={(ev) => { ev.stopPropagation(); handleDeleteDoc(d.id, d.filename); }}
                        className="text-[var(--color-text-tertiary)] hover:text-red-400 transition-colors"
                        title="Delete document"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <p className="text-[0.65rem] text-[var(--color-text-tertiary)]">Drop to add another CP Recap</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <Upload className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                <p className="text-xs text-[var(--color-text-tertiary)]">Drop CP Recap here</p>
              </div>
            )}
          </div>

          {/* AI Q&A — read CP recap + base form (BPVOY4 etc.), cite source.
              Only meaningful once a recap has been uploaded; before that the
              endpoint returns an actionable error message. */}
          {cpDocs.length > 0 && (
            <CpQaPanel linkageId={linkage.id} canEdit={canEdit} />
          )}

          {/* Workflow steps — always visible, disabled when no vessel */}
          {steps.length > 0 && (
            <div className={`${!hasVessel ? "opacity-50" : ""}`}>
              <div className="flex items-center gap-3 mb-3">
                <Ship className="h-4 w-4 text-cyan-400" />
                <p className="text-sm font-semibold text-[var(--color-text-primary)] uppercase tracking-wide">
                  Vessel Workflow
                </p>
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {doneCount}/{steps.length}
                </span>
                {/* Progress bar */}
                <div className="flex-1 h-1.5 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-cyan-500 transition-all"
                    style={{ width: `${steps.length > 0 ? (doneCount / steps.length) * 100 : 0}%` }}
                  />
                </div>
                {!hasVessel && (
                  <span className="text-xs text-amber-400/80 italic">
                    Vessel required
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {steps.map((s) => {
                  const isSent = s.status === "sent" || s.status === "done";
                  const isNeedsUpdate = s.status === "needs_update";
                  const borderColor = isSent
                    ? "border-green-500/40 bg-green-500/[0.06]"
                    : isNeedsUpdate
                    ? "border-red-500/40 bg-red-500/[0.06]"
                    : "border-cyan-500/30 bg-cyan-500/[0.04]";
                  const textColor = isSent
                    ? "text-green-400"
                    : isNeedsUpdate
                    ? "text-red-400"
                    : "text-[var(--color-text-secondary)]";

                  return (
                    <div
                      key={s.id}
                      className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border ${borderColor} transition-colors`}
                    >
                      <div className="flex items-center gap-3">
                        <CircleDot className={`h-4 w-4 ${textColor}`} />
                        <span className={`text-sm font-medium ${textColor}`}>{s.stepName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {canEdit && hasVessel && !isSent && !isNeedsUpdate && (
                          <button
                            onClick={() => handleStepStatusChange(s.id, "sent")}
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-colors cursor-pointer"
                          >
                            Mark Sent
                          </button>
                        )}
                        {canEdit && hasVessel && isSent && (
                          <button
                            onClick={() => handleStepStatusChange(s.id, "pending")}
                            title="Undo — revert to pending"
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border-subtle)] transition-colors cursor-pointer"
                          >
                            Undo
                          </button>
                        )}
                        {canEdit && hasVessel && isNeedsUpdate && (
                          <>
                            <button
                              onClick={() => handleStepStatusChange(s.id, "sent")}
                              className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors cursor-pointer"
                            >
                              Re-sent
                            </button>
                            <button
                              onClick={() => handleStepStatusChange(s.id, "pending")}
                              className="px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border-subtle)] transition-colors cursor-pointer"
                            >
                              Reset
                            </button>
                          </>
                        )}
                        <StepStatusBadge status={s.status} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add step */}
          {canEdit && (
            <div className="pt-1">
              {addingStep || newStepName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Step name (e.g. LOI, Discharge Orders)"
                    value={newStepName}
                    onChange={(e) => setNewStepName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddStep()}
                    className="flex-1 text-xs px-2 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
                    autoFocus
                  />
                  <button
                    onClick={handleAddStep}
                    disabled={!newStepName.trim()}
                    className="px-2 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--color-accent)] text-black font-medium disabled:opacity-50 cursor-pointer"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setNewStepName(""); setAddingStep(false); }}
                    className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingStep(true)}
                  className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add step
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {parseResult && (
        <Q88ParseModal
          result={parseResult}
          currentVesselName={linkage.vesselName}
          currentVesselImo={linkage.vesselImo}
          currentVesselMmsi={linkage.vesselMmsi}
          hasExistingParticulars={Boolean(linkage.vesselParticulars)}
          onApply={applyParseResult}
          onClose={() => setParseResult(null)}
        />
      )}

      {showPlanner && linkage.vesselParticulars && (
        <PlannerModal
          linkage={linkage}
          onClose={() => setShowPlanner(false)}
        />
      )}
    </Card>
  );
}

// ── Q88 Parse Confirm Modal ──────────────────────────────────

function Q88ParseModal({
  result,
  currentVesselName,
  currentVesselImo,
  currentVesselMmsi,
  hasExistingParticulars,
  onApply,
  onClose,
}: {
  result: {
    vesselName: string | null;
    vesselImo: string | null;
    vesselMmsi: string | null;
    particulars: VesselParticulars;
    confidenceScores: Record<string, number>;
  };
  currentVesselName: string | null;
  currentVesselImo: string | null;
  currentVesselMmsi: string | null;
  hasExistingParticulars: boolean;
  onApply: (accept: { vesselName: boolean; vesselImo: boolean; vesselMmsi: boolean; particulars: boolean }) => void;
  onClose: () => void;
}) {
  const [acceptName, setAcceptName] = useState(Boolean(result.vesselName));
  const [acceptImo, setAcceptImo] = useState(Boolean(result.vesselImo));
  const [acceptMmsi, setAcceptMmsi] = useState(Boolean(result.vesselMmsi));
  const [acceptParticulars, setAcceptParticulars] = useState(true);

  const p = result.particulars;
  const confidence = (k: string) => {
    const v = result.confidenceScores[k];
    if (typeof v !== "number") return null;
    const colour = v >= 0.9 ? "text-emerald-400" : v >= 0.7 ? "text-amber-400" : "text-red-400";
    return <span className={`text-[0.6rem] ${colour}`}>({Math.round(v * 100)}%)</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-auto">
      <div className="w-full max-w-2xl rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-5 py-3">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Q88 parsed — review and apply
          </h3>
          <button
            onClick={onClose}
            className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 text-xs text-[var(--color-text-secondary)]">
          {/* Vessel identity */}
          <section className="space-y-2">
            <h4 className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
              Vessel identity
            </h4>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptName}
                onChange={(e) => setAcceptName(e.target.checked)}
                disabled={!result.vesselName}
                className="mt-0.5 accent-cyan-500"
              />
              <span className="flex-1">
                <span className="text-[var(--color-text-tertiary)]">Vessel name:</span>{" "}
                <span className="font-medium text-[var(--color-text-primary)]">
                  {result.vesselName ?? "— not found —"}
                </span>{" "}
                {confidence("vessel_name")}
                {currentVesselName && currentVesselName !== result.vesselName && (
                  <span className="text-[0.65rem] text-amber-400 block">
                    replaces current: {currentVesselName}
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptImo}
                onChange={(e) => setAcceptImo(e.target.checked)}
                disabled={!result.vesselImo}
                className="mt-0.5 accent-cyan-500"
              />
              <span className="flex-1">
                <span className="text-[var(--color-text-tertiary)]">IMO:</span>{" "}
                <span className="font-medium text-[var(--color-text-primary)]">
                  {result.vesselImo ?? "— not found —"}
                </span>{" "}
                {confidence("vessel_imo")}
                {currentVesselImo && currentVesselImo !== result.vesselImo && (
                  <span className="text-[0.65rem] text-amber-400 block">
                    replaces current: {currentVesselImo}
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptMmsi}
                onChange={(e) => setAcceptMmsi(e.target.checked)}
                disabled={!result.vesselMmsi}
                className="mt-0.5 accent-cyan-500"
              />
              <span className="flex-1">
                <span className="text-[var(--color-text-tertiary)]">MMSI:</span>{" "}
                <span className="font-medium text-[var(--color-text-primary)]">
                  {result.vesselMmsi ?? "— not found —"}
                </span>{" "}
                {confidence("vessel_mmsi")}
                <span className="block text-[0.6rem] text-[var(--color-text-tertiary)]">
                  Enables live AIS tracking on the Fleet map.
                </span>
                {currentVesselMmsi && currentVesselMmsi !== result.vesselMmsi && (
                  <span className="text-[0.65rem] text-amber-400 block">
                    replaces current: {currentVesselMmsi}
                  </span>
                )}
              </span>
            </label>
          </section>

          {/* Particulars preview */}
          <section className="space-y-2">
            <h4 className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
              Vessel particulars
              {hasExistingParticulars && (
                <span className="ml-2 text-amber-400 normal-case text-[0.65rem]">
                  (will replace existing)
                </span>
              )}
            </h4>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptParticulars}
                onChange={(e) => setAcceptParticulars(e.target.checked)}
                className="mt-0.5 accent-cyan-500"
              />
              <span className="flex-1">Apply particulars + tank capacities (used by Planner Mode)</span>
            </label>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] px-3 py-2">
              <Kv label="DWT">{fmt(p.dwt, " MT")}</Kv>
              <Kv label="Built">{p.builtYear ?? "—"}</Kv>
              <Kv label="LOA">{fmt(p.loa, " m")}</Kv>
              <Kv label="Beam">{fmt(p.beam, " m")}</Kv>
              <Kv label="Summer draft">{fmt(p.summerDraft, " m")}</Kv>
              <Kv label="Flag">{p.flag ?? "—"}</Kv>
              <Kv label="Class">{p.classSociety ?? "—"}</Kv>
              <Kv label="Type">{p.vesselType ?? "—"}</Kv>
              <Kv label="Coating">{p.coating ?? "—"}</Kv>
              <Kv label="Segregations">{p.segregations ?? "—"}</Kv>
              <Kv label="Tanks">{p.tankCount ?? p.tanks?.length ?? "—"}</Kv>
              <Kv label="Cargo @98%">{fmt(p.totalCargoCapacity98, " m³")}</Kv>
            </div>

            {p.tanks && p.tanks.length > 0 && (
              <details className="text-[0.7rem]">
                <summary className="cursor-pointer text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
                  {p.tanks.length} tanks parsed — expand
                </summary>
                <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)]">
                      <tr>
                        <th className="text-left px-2 py-1 font-normal">Tank</th>
                        <th className="text-right px-2 py-1 font-normal">100% (m³)</th>
                        <th className="text-right px-2 py-1 font-normal">98% (m³)</th>
                        <th className="text-left px-2 py-1 font-normal">Coating</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.tanks.map((t, i) => (
                        <tr key={i} className="border-t border-[var(--color-border-subtle)]">
                          <td className="px-2 py-1 font-medium">{t.name}</td>
                          <td className="px-2 py-1 text-right">{fmt(t.capacity100)}</td>
                          <td className="px-2 py-1 text-right">{fmt(t.capacity98)}</td>
                          <td className="px-2 py-1 text-[var(--color-text-tertiary)]">{t.coating ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() =>
              onApply({
                vesselName: acceptName,
                vesselImo: acceptImo,
                vesselMmsi: acceptMmsi,
                particulars: acceptParticulars,
              })
            }
            disabled={!acceptName && !acceptImo && !acceptParticulars}
          >
            Apply selected
          </Button>
        </div>
      </div>
    </div>
  );
}

function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[var(--color-text-tertiary)]">{label}:</span>
      <span className="text-[var(--color-text-primary)]">{children}</span>
    </div>
  );
}

function fmt(v: number | null | undefined, suffix = ""): string {
  if (v == null || !Number.isFinite(v)) return "—";
  // Format with thousand separators, no decimals unless non-integer
  const rounded = Math.round(v * 100) / 100;
  const str = Number.isInteger(rounded)
    ? rounded.toLocaleString("en-US")
    : rounded.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${str}${suffix}`;
}

// ── Step Status Badge ────────────────────────────────────────

function StepStatusBadge({ status, label: customLabel }: { status: string; label?: string }) {
  const styles: Record<string, string> = {
    pending: "bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)]",
    ready: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
    draft_generated: "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30",
    sent: "bg-green-500/15 text-green-400 border border-green-500/30",
    received: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
    done: "bg-green-500/15 text-green-400 border border-green-500/30",
    needs_update: "bg-red-500/15 text-red-400 border border-red-500/30",
    cancelled: "bg-red-500/10 text-red-400/60 line-through",
    na: "bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)]",
  };
  const label: Record<string, string> = {
    pending: "Pending",
    ready: "Ready",
    draft_generated: "Draft",
    sent: "Sent",
    received: "Received",
    done: "Done",
    needs_update: "Re-send!",
    cancelled: "Cancelled",
    na: "N/A",
  };
  const displayLabel = customLabel ?? label[status] ?? status;
  return (
    <span className={`px-2 py-1 rounded-[var(--radius-sm)] text-xs font-medium whitespace-nowrap ${styles[status] ?? styles.pending}`}>
      {displayLabel}
    </span>
  );
}

// ── Deal Card ────────────────────────────────────────────────

function DealCard({ deal, steps, onDeleted, canDelete }: { deal: DealSummary; steps: WorkflowStep[]; onDeleted: () => void; canDelete: boolean }) {
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/deals/${deal.id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Deal deleted"); onDeleted(); }
    else toast.error("Failed to delete deal");
    setDeleting(false);
    setConfirmOpen(false);
  };

  const isTerminal = deal.dealType === "terminal_operation";
  const borderColor = isTerminal ? "border-l-teal-500/60" : deal.direction === "buy" ? "border-l-blue-500/60" : "border-l-amber-500/60";
  const isMultiParcel = (deal.parcelCount ?? 1) > 1 && (deal.parcels?.length ?? 0) > 1;

  return (
    <>
      <Card className={`border-l-[3px] ${borderColor}`}>
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <Link href={`/deals/${deal.id}`} className="flex items-center gap-2 min-w-0 hover:underline">
            <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{deal.counterparty}</span>
            <Badge variant={deal.direction === "buy" ? "info" : "accent"} className="text-[0.6rem]">{deal.direction}</Badge>
            <span className="text-xs text-[var(--color-text-tertiary)]">{deal.incoterm}</span>
            {isMultiParcel && (
              <span title="Multi-parcel deal — breakdown below">
                <Badge variant="muted" className="text-[0.6rem]">
                  {deal.parcels!.length} parcels
                </Badge>
              </span>
            )}
          </Link>
          <div className="flex items-center gap-1.5">
            <Badge variant="muted" className="text-[0.6rem]">{deal.status}</Badge>
            {canDelete && (
              <button onClick={() => setConfirmOpen(true)} className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] transition-colors cursor-pointer">
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <div className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
          <div>
            <span className="text-[var(--color-text-tertiary)]">Qty:</span>{" "}
            {Number(deal.quantityMt).toLocaleString()} MT
            {isMultiParcel && (
              <span className="text-[0.65rem] text-[var(--color-text-tertiary)]"> total</span>
            )}
          </div>
          <div><span className="text-[var(--color-text-tertiary)]">Loadport:</span> {deal.loadport}</div>
          {deal.dischargePort && <div><span className="text-[var(--color-text-tertiary)]">Discharge:</span> {deal.dischargePort}</div>}
          <div><span className="text-[var(--color-text-tertiary)]">Laycan:</span> {deal.laycanStart} — {deal.laycanEnd}</div>
        </div>
        {isMultiParcel && (
          <div className="px-4 pb-3 border-t border-[var(--color-border-subtle)] pt-2 space-y-0.5">
            <div className="text-[0.6rem] uppercase tracking-wide text-[var(--color-text-tertiary)] mb-1">
              Parcels
            </div>
            {deal.parcels!.map((p) => (
              <div key={p.parcelNo} className="flex items-baseline gap-2 text-xs">
                <span className="text-[var(--color-text-tertiary)] tabular-nums w-5">#{p.parcelNo}</span>
                <span className="font-medium text-[var(--color-text-primary)] truncate">{p.product}</span>
                <span className="text-[var(--color-text-secondary)] tabular-nums">
                  {Number(p.quantityMt).toLocaleString()} MT
                </span>
                {p.contractedQty && (
                  <span className="text-[0.65rem] text-[var(--color-text-tertiary)] truncate">
                    ({p.contractedQty})
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {/* Workflow steps */}
        {steps.length > 0 && (() => {
          const doneCount = steps.filter((s) => s.status === "sent" || s.status === "done" || s.status === "received").length;
          const needsUpdateCount = steps.filter((s) => s.status === "needs_update").length;
          const pct = Math.round((doneCount / steps.length) * 100);
          return (
            <div className="px-4 pb-3 pt-2 border-t border-[var(--color-border-subtle)]">
              {/* Progress header */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
                  Workflow
                </span>
                <div className="flex items-center gap-2">
                  {needsUpdateCount > 0 && (
                    <span className="text-xs font-medium text-red-400">
                      {needsUpdateCount} needs re-send
                    </span>
                  )}
                  <span className="text-xs font-mono text-[var(--color-text-tertiary)]">
                    {doneCount}/{steps.length}
                  </span>
                </div>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 rounded-full bg-[var(--color-surface-3)] mb-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${needsUpdateCount > 0 ? "bg-red-500" : "bg-green-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {/* Step chips */}
              <div className="flex flex-wrap gap-1.5">
                {steps.map((s) => (
                  <StepStatusBadge key={s.id} status={s.status} label={s.stepName} />
                ))}
              </div>
            </div>
          );
        })()}
      </Card>

      {/* Delete confirmation */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !deleting && setConfirmOpen(false)}>
          <div className="bg-[var(--color-surface-1)] border border-[var(--color-border-default)] rounded-[var(--radius-lg)] p-5 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">Delete this deal?</h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-4">This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} disabled={deleting} className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] cursor-pointer disabled:opacity-50">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--color-danger)] text-white cursor-pointer disabled:opacity-50">{deleting ? "Deleting..." : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Add Deal Menu (popup with 3 options) ─────────────────────

interface TerminalParty {
  id: string;
  name: string;
  port: string | null;
  isFixed: boolean;
}

/**
 * SessionStorage key used to hand a dropped recap from the linkage view's
 * AddDealMenu over to the /deals/parse page. The parse page reads it on
 * mount when the URL carries `?fromDrop=1`, populates rawText, and auto-
 * triggers a parse so the operator lands directly on the confirmation view.
 *
 * Versioned in case the payload shape evolves.
 */
const DROPPED_RECAP_KEY = "nefgo:parse-drop:v1";

function AddDealMenu({ linkageId, linkageCode, side, variant, siblingDeals = [] }: {
  linkageId: string;
  linkageCode: string;
  side: "buy" | "sell";
  variant: "placeholder" | "compact";
  /**
   * Deals on the OPPOSITE side of this linkage. Used to seed smart defaults
   * for the load/discharge ports when creating an own-terminal operation:
   *   - "Discharge to own terminal" (this side = sell): cargo was loaded
   *     wherever the sibling buy says it was loaded — pre-fill loadport
   *     with the buy's loadport so the operator doesn't get the terminal
   *     name dumped into both fields.
   *   - "Load from own terminal" (this side = buy): cargo will be delivered
   *     wherever the sibling sell points to — pre-fill dischargePort.
   * Empty array when there are no sibling deals yet — defaults fall back to
   * blanks for the inherited side, the operator types the value manually.
   */
  siblingDeals?: DealSummary[];
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [terminalPicker, setTerminalPicker] = useState(false);
  const [terminals, setTerminals] = useState<TerminalParty[]>([]);
  const [loadingTerminals, setLoadingTerminals] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  // Two-step flow for own-terminal operations: pick a terminal, THEN review
  // and edit the load/discharge ports before submitting. Without this step
  // the previous version forced both ports to the terminal name, which
  // broke "Discharge to own terminal" voyages where the cargo was loaded
  // at a different port (e.g. buy at Genoa, discharge at Vopak Amsterdam).
  const [chosenTerminal, setChosenTerminal] = useState<TerminalParty | null>(null);
  const [formLoadport, setFormLoadport] = useState("");
  const [formDischarge, setFormDischarge] = useState("");
  // Drag-drop state — applies to the placeholder variant only. When a recap
  // file is dropped here we extract text inline, stash it for the parse
  // page, then navigate so the operator lands on the confirmation form
  // with linkage + direction already locked in.
  const [dragOver, setDragOver] = useState(false);
  const [dropProcessing, setDropProcessing] = useState(false);

  const direction = side;
  const label = side === "buy" ? "Add purchase / loading" : "Add sale / discharge";
  const terminalLabel = side === "buy" ? "Load from own terminal" : "Discharge to own terminal";

  const openMenu = () => setMenuOpen(true);
  const closeAll = () => {
    setMenuOpen(false);
    setTerminalPicker(false);
    setChosenTerminal(null);
    setFormLoadport("");
    setFormDischarge("");
  };

  /**
   * Compute smart defaults for the load/discharge port form when a terminal
   * is picked. The terminal port goes on the side that matches the action
   * (load OR discharge); the OTHER side is inherited from the first sibling
   * deal in the linkage if one exists. Operator can override either before
   * submitting.
   */
  const computePortDefaults = useCallback(
    (terminal: TerminalParty): { loadport: string; dischargePort: string } => {
      const terminalPort = terminal.port ?? terminal.name;
      const sibling = siblingDeals[0];
      if (side === "buy") {
        // "Load from own terminal" — we load at the terminal, deliver to
        // wherever the sibling sell says (or leave blank for now).
        return {
          loadport: terminalPort,
          dischargePort: sibling?.dischargePort ?? "",
        };
      }
      // side === "sell" — "Discharge to own terminal" — cargo was loaded
      // at the sibling buy's loadport (the operator's actual physical
      // origin), discharged at the terminal.
      return {
        loadport: sibling?.loadport ?? "",
        dischargePort: terminalPort,
      };
    },
    [side, siblingDeals]
  );

  const pickTerminal = (terminal: TerminalParty) => {
    const defaults = computePortDefaults(terminal);
    setChosenTerminal(terminal);
    setFormLoadport(defaults.loadport);
    setFormDischarge(defaults.dischargePort);
  };

  const goParseEmail = () => {
    closeAll();
    router.push(`/deals/parse?linkageId=${encodeURIComponent(linkageId)}&linkageCode=${encodeURIComponent(linkageCode)}&direction=${direction}`);
  };

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only react when the drag carries actual files — ignore text drags etc.
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    if (!dropProcessing) setDragOver(true);
  }, [dropProcessing]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (dropProcessing) return;

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setDropProcessing(true);
    try {
      const { extractTextFromFile } = await import("@/lib/utils/extract-file-text");
      const text = await extractTextFromFile(file);
      // Stash the extracted text + filename for the parse page to pick up.
      // Using sessionStorage rather than URL params because a recap can be
      // tens of KB — too big for a query string.
      sessionStorage.setItem(
        DROPPED_RECAP_KEY,
        JSON.stringify({
          text,
          filename: file.name,
          linkageId,
          direction,
        })
      );
      router.push(
        `/deals/parse?linkageId=${encodeURIComponent(linkageId)}` +
          `&linkageCode=${encodeURIComponent(linkageCode)}` +
          `&direction=${direction}` +
          `&fromDrop=1`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to read file";
      toast.error(message);
      setDropProcessing(false);
    }
    // Note: don't reset dropProcessing on success — we're about to navigate
    // away. If navigation fails for some reason the spinner stays until
    // unmount, which is acceptable.
  }, [dropProcessing, linkageId, linkageCode, direction, router]);

  const goManualEntry = () => {
    closeAll();
    router.push(`/deals/new?linkageId=${encodeURIComponent(linkageId)}&linkageCode=${encodeURIComponent(linkageCode)}&direction=${direction}`);
  };

  const openTerminalPicker = async () => {
    setMenuOpen(false);
    setTerminalPicker(true);
    setLoadingTerminals(true);
    try {
      const res = await fetch("/api/parties?type=terminal");
      const data = await res.json();
      const all: TerminalParty[] = Array.isArray(data) ? data : [...(data.matched ?? []), ...(data.rest ?? [])];
      setTerminals(all.filter((t) => t.isFixed));
    } catch {
      setTerminals([]);
    }
    setLoadingTerminals(false);
  };

  const handleTerminalOperation = async () => {
    if (!chosenTerminal) return;
    // Loadport is NOT NULL on the deals table — fall back to "TBD" so the
    // create call succeeds even if the operator clears the field. They can
    // still set the real value via the deal detail edit page later.
    const finalLoadport = formLoadport.trim() || "TBD";
    const finalDischarge = formDischarge.trim() || null;

    setCreating(chosenTerminal.id);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const isBuy = side === "buy";
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterparty: `Own Terminal \u2014 ${chosenTerminal.name}`,
          direction,
          dealType: "terminal_operation",
          product: "Gasoline",
          quantityMt: 1,
          incoterm: "FOB",
          loadport: finalLoadport,
          dischargePort: finalDischarge,
          laycanStart: today,
          laycanEnd: today,
          linkageId,
          linkageCode,
          specialInstructions: `${isBuy ? "Load from" : "Discharge to"} own terminal: ${chosenTerminal.name}`,
        }),
      });
      if (res.ok) {
        toast.success(`${isBuy ? "Load from" : "Discharge to"} ${chosenTerminal.name} created`);
        closeAll();
        window.dispatchEvent(new CustomEvent("linkage:deal-added"));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to create terminal operation");
      }
    } catch {
      toast.error("Failed to create terminal operation");
    }
    setCreating(null);
  };

  // Terminal picker sub-view (and post-pick port-edit form)
  if (terminalPicker) {
    return (
      <div className="rounded-[var(--radius-md)] border-2 border-dashed border-teal-400/50 bg-teal-50/30 dark:bg-teal-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{terminalLabel}</span>
          <button onClick={closeAll} className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {chosenTerminal ? (
          // Step 2: edit ports before submit. Smart defaults from sibling
          // deals already populated the inputs; operator can override.
          <div className="space-y-3">
            <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] px-3 py-2 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-[var(--color-text-primary)]">{chosenTerminal.name}</div>
                {chosenTerminal.port && (
                  <div className="text-xs text-[var(--color-text-tertiary)]">{chosenTerminal.port}</div>
                )}
              </div>
              <button
                onClick={() => { setChosenTerminal(null); setFormLoadport(""); setFormDischarge(""); }}
                className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] cursor-pointer"
              >
                Change
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">
                <span className="block text-[var(--color-text-secondary)] mb-1">
                  Loadport
                  {side === "sell" && siblingDeals[0]?.loadport && (
                    <span className="ml-1 text-[var(--color-text-tertiary)] font-normal">
                      (from buy)
                    </span>
                  )}
                </span>
                <input
                  type="text"
                  value={formLoadport}
                  onChange={(e) => setFormLoadport(e.target.value)}
                  placeholder="e.g. Genoa, IT"
                  className="w-full px-2 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-1)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-teal-500"
                />
              </label>
              <label className="text-xs">
                <span className="block text-[var(--color-text-secondary)] mb-1">
                  Discharge port
                  {side === "buy" && siblingDeals[0]?.dischargePort && (
                    <span className="ml-1 text-[var(--color-text-tertiary)] font-normal">
                      (from sale)
                    </span>
                  )}
                </span>
                <input
                  type="text"
                  value={formDischarge}
                  onChange={(e) => setFormDischarge(e.target.value)}
                  placeholder="e.g. Amsterdam"
                  className="w-full px-2 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-1)] border border-[var(--color-border-default)] text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-teal-500"
                />
              </label>
            </div>

            <div className="flex items-center gap-2 justify-end pt-1">
              <button
                onClick={closeAll}
                className="px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleTerminalOperation}
                disabled={creating !== null}
                className="px-3 py-1.5 text-xs bg-teal-500/80 hover:bg-teal-500 text-white rounded-[var(--radius-sm)] cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {creating !== null && (
                  <div className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                )}
                Create
              </button>
            </div>
          </div>
        ) : loadingTerminals ? (
          <div className="flex justify-center py-4">
            <div className="h-4 w-4 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
          </div>
        ) : terminals.length === 0 ? (
          <p className="text-xs text-[var(--color-text-tertiary)] text-center py-4">No terminals found</p>
        ) : (
          // Step 1: pick terminal. Click forwards to step 2 (port-edit form)
          // instead of submitting immediately.
          <div className="space-y-1.5">
            {terminals.map((t) => (
              <button
                key={t.id}
                onClick={() => pickTerminal(t)}
                className="w-full text-left px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] hover:border-teal-500/40 hover:bg-teal-900/10 transition-colors cursor-pointer flex items-center justify-between"
              >
                <div>
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">{t.name}</div>
                  {t.port && <div className="text-xs text-[var(--color-text-tertiary)]">{t.port}</div>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Large placeholder for empty columns
  if (variant === "placeholder") {
    return (
      <div className="relative">
        {menuOpen ? (
          <div className="rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--color-accent)]/30 bg-[var(--color-surface-2)] p-4 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">{label}</span>
              <button onClick={closeAll} className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] cursor-pointer">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <button onClick={goManualEntry} className="w-full text-left px-3 py-2.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer">
              <div className="text-sm font-medium text-[var(--color-text-primary)]">Manual entry</div>
              <div className="text-xs text-[var(--color-text-tertiary)]">Create a deal from scratch</div>
            </button>
            <button onClick={goParseEmail} className="w-full text-left px-3 py-2.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer">
              <div className="text-sm font-medium text-[var(--color-text-primary)]">Parse email</div>
              <div className="text-xs text-[var(--color-text-tertiary)]">AI extracts deal from trader email</div>
            </button>
            <button onClick={openTerminalPicker} className="w-full text-left px-3 py-2.5 rounded-[var(--radius-sm)] hover:bg-teal-900/10 transition-colors cursor-pointer">
              <div className="text-sm font-medium text-teal-400">{terminalLabel}</div>
              <div className="text-xs text-[var(--color-text-tertiary)]">Amsterdam, Lavera, Antwerp</div>
            </button>
          </div>
        ) : (
          <div
            onClick={openMenu}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`rounded-[var(--radius-lg)] border-2 border-dashed py-10 flex flex-col items-center justify-center gap-3 transition-colors cursor-pointer ${
              dragOver
                ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]/40"
                : "border-[var(--color-border-subtle)] hover:border-[var(--color-border-default)] hover:bg-[var(--color-surface-2)]/50"
            }`}
          >
            <div className={`h-14 w-14 rounded-full border flex items-center justify-center ${
              dragOver
                ? "bg-[var(--color-accent-muted)] border-[var(--color-accent)]"
                : "bg-[var(--color-surface-3)] border-[var(--color-border-default)] group-hover:bg-[var(--color-surface-4)]"
            }`}>
              {dropProcessing ? (
                <Loader2 className="h-6 w-6 text-[var(--color-accent)] animate-spin" />
              ) : dragOver ? (
                <Upload className="h-6 w-6 text-[var(--color-accent)]" />
              ) : (
                <Plus className="h-6 w-6 text-[var(--color-text-tertiary)]" />
              )}
            </div>
            <div className="text-center">
              <span className={`block text-sm ${dragOver ? "text-[var(--color-accent-text)] font-medium" : "text-[var(--color-text-tertiary)]"}`}>
                {dropProcessing ? "Reading recap…" : dragOver ? "Drop recap to parse" : label}
              </span>
              {!dragOver && !dropProcessing && (
                <span className="block text-[0.6875rem] text-[var(--color-text-tertiary)] mt-1">
                  click for options · or drop a recap file
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Compact buttons for non-empty columns
  return (
    <div className="relative">
      {menuOpen ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-2)] p-2 space-y-1">
          <button onClick={goManualEntry} className="w-full text-left px-2.5 py-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer text-xs text-[var(--color-text-secondary)]">
            Manual entry
          </button>
          <button onClick={goParseEmail} className="w-full text-left px-2.5 py-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-3)] transition-colors cursor-pointer text-xs text-[var(--color-text-secondary)]">
            Parse email
          </button>
          <button onClick={openTerminalPicker} className="w-full text-left px-2.5 py-1.5 rounded-[var(--radius-sm)] hover:bg-teal-900/10 transition-colors cursor-pointer text-xs text-teal-400">
            {terminalLabel}
          </button>
        </div>
      ) : (
        <button onClick={openMenu} className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-text)] transition-colors cursor-pointer">
          <Plus className="h-3 w-3" /> Add
        </button>
      )}
    </div>
  );
}

// ── Delete Linkage Button ────────────────────────────────────

function DeleteLinkageButton({ linkageId, dealCount, onDeleted }: { linkageId: string; dealCount: number; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    // Delete all deals first, then the linkage
    const dealsRes = await fetch(`/api/deals?linkageId=${linkageId}&perPage=100&_t=${Date.now()}`, { cache: "no-store" });
    const dealsData = await dealsRes.json();
    for (const d of dealsData.items ?? []) {
      await fetch(`/api/deals/${d.id}`, { method: "DELETE" });
    }
    const res = await fetch(`/api/linkages/${linkageId}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) { toast.success("Linkage deleted"); onDeleted(); }
    else { const err = await res.json().catch(() => ({})); toast.error(err.message || "Failed to delete"); setOpen(false); }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10">
        <Trash2 className="h-3.5 w-3.5" /> Delete Linkage
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => !deleting && setOpen(false)}>
          <div className="bg-[var(--color-surface-1)] border border-[var(--color-border-default)] rounded-[var(--radius-lg)] p-5 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-2">Delete this linkage?</h3>
            <p className="text-xs text-[var(--color-text-secondary)] mb-4">
              {dealCount > 0 ? `This will permanently delete ${dealCount} deal${dealCount !== 1 ? "s" : ""} and all their workflow data. ` : ""}
              This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} disabled={deleting} className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] cursor-pointer disabled:opacity-50">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--color-danger)] text-white cursor-pointer disabled:opacity-50">{deleting ? "Deleting..." : "Delete Linkage"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Planner Mode Modal ──────────────────────────────────────
//
// Top-down stowage plan view. The operator inputs cargo density (kg/m³) and
// the planner computes how much cargo can be loaded per tank, using 98%
// capacity as the cargo fill rule (IMO convention — 2% ullage for thermal
// expansion). Totals across selected tanks give a quick sanity check against
// the nominated quantity before loading.
//
// The tank layout is derived from the parsed Q88:
//   - Tanks ending in "P" go port (top row), "S" starboard (bottom row).
//   - Tank numbers determine column order. Per IMO MARPOL Annex I and OCIMF
//     convention, Tank 1 is forwardmost (at the bow); higher numbers run
//     aft toward the stern. The SVG renders columns in reverse so Tank 1
//     sits at the right edge (where the hull tapers into the bow).
//   - Slop tanks go at the stern, aft of the cargo space near the pump
//     room — drawn on the left of the SVG.
// SVG width is adaptive to the column count: typical MRs with 6 pairs fit
// the modal at 760 px; chemical parcel tankers with 12-25+ pairs (e.g. Bow
// Faith with 25 tank pairs / 52 cargo tanks) widen the SVG and the
// container scrolls horizontally so each cell stays readable.

// Stowage planner supports multi-product loading. A "product" is one cargo
// grade with its own density (e.g. RON95 gasoline @ 740 kg/m³, RON98 @ 745,
// ULSD @ 830, methanol @ 800). Each tank is assigned to at most one product
// (or unassigned). Cargo MT per tank = capacity98 × productDensity / 1000.
// This applies equally to product tankers running multi-grade clean-product
// voyages and to chemical parcel tankers — the shape is universal.
type StowageProduct = {
  id: string;
  name: string;
  density: number;
  colorClass: string;
};

const PRODUCT_COLORS = [
  "cyan",
  "amber",
  "emerald",
  "rose",
  "violet",
  "indigo",
  "lime",
  "fuchsia",
] as const;

// RGB triplets corresponding to PRODUCT_COLORS. Used inline for SVG fill
// because Tailwind utility classes don't compose into the rgba() syntax we
// need for the per-tank intensity gradient.
const PRODUCT_RGB: Record<string, string> = {
  cyan: "34, 211, 238",
  amber: "245, 158, 11",
  emerald: "16, 185, 129",
  rose: "244, 63, 94",
  violet: "139, 92, 246",
  indigo: "99, 102, 241",
  lime: "132, 204, 22",
  fuchsia: "232, 121, 249",
};

function PlannerModal({
  linkage,
  onClose,
}: {
  linkage: LinkageData;
  onClose: () => void;
}) {
  const particulars = linkage.vesselParticulars!;
  const tanks = particulars.tanks ?? [];
  const loadlines = particulars.loadlines ?? [];

  // Default to the Summer loadline since that's the industry default and the
  // AI parser puts it at the top. If parse didn't find any loadlines, the
  // top-level particulars.dwt is still shown as the ceiling.
  const defaultLoadlineName =
    loadlines.find((l) => /^summer$/i.test(l.name))?.name ?? loadlines[0]?.name ?? "";
  const [selectedLoadlineName, setSelectedLoadlineName] = useState<string>(defaultLoadlineName);
  const selectedLoadline =
    loadlines.find((l) => l.name === selectedLoadlineName) ?? null;
  const dwtCeiling = selectedLoadline?.dwt ?? particulars.dwt ?? null;

  // Multi-product stowage. The default is a single "Cargo" product at
  // 740 kg/m³ (gasoline midpoint) with every tank pre-assigned, which
  // preserves the single-density behaviour the planner had before
  // multi-product support landed. The operator adds more products via
  // the Products panel and reassigns tanks by clicking on them with a
  // different product armed.
  const [products, setProducts] = useState<StowageProduct[]>(() => [
    { id: "p1", name: "Cargo", density: 740, colorClass: PRODUCT_COLORS[0] },
  ]);
  const [tankAssignments, setTankAssignments] = useState<Record<string, string>>(
    () => Object.fromEntries(tanks.map((t) => [t.name, "p1"]))
  );
  const [activeProductId, setActiveProductId] = useState<string>("p1");

  const getProduct = (id: string | null | undefined): StowageProduct | null => {
    if (!id) return null;
    return products.find((p) => p.id === id) ?? null;
  };

  const addProduct = () => {
    const id = `p${Date.now()}`;
    setProducts((prev) => [
      ...prev,
      {
        id,
        name: `Product ${prev.length + 1}`,
        density: 740,
        colorClass: PRODUCT_COLORS[prev.length % PRODUCT_COLORS.length],
      },
    ]);
    setActiveProductId(id);
  };

  const removeProduct = (id: string) => {
    if (products.length <= 1) return;
    setTankAssignments((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (v !== id) next[k] = v;
      }
      return next;
    });
    const remaining = products.filter((p) => p.id !== id);
    setProducts(remaining);
    if (activeProductId === id) setActiveProductId(remaining[0]?.id ?? "");
  };

  const updateProduct = (id: string, patch: Partial<StowageProduct>) => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const toggleTank = (name: string) => {
    setTankAssignments((prev) => {
      const next = { ...prev };
      if (next[name] === activeProductId) {
        // Same product armed → unassign on second click.
        delete next[name];
      } else {
        // Different product or unassigned → set to active product.
        next[name] = activeProductId;
      }
      return next;
    });
  };

  const parsed = tanks.map((t) => {
    const match = t.name.trim().toUpperCase().match(/^(SLOP\s*)?(\d+)?\s*([PS])?$/);
    const isSlop = /^SLOP/i.test(t.name);
    const num = match && match[2] ? parseInt(match[2], 10) : null;
    const side: "P" | "S" | "C" =
      match && match[3] === "P" ? "P" : match && match[3] === "S" ? "S" : "C";
    return { ...t, _num: num, _side: side, _isSlop: isSlop };
  });

  const numberedTanks = parsed.filter((t) => t._num != null && !t._isSlop);
  const slopTanks = parsed.filter((t) => t._isSlop);
  const otherTanks = parsed.filter((t) => t._num == null && !t._isSlop);

  // Reverse-sort so Tank 1 ends up rightmost (at the bow / hull taper) and
  // higher numbers march left toward the stern, matching IMO/OCIMF tanker
  // numbering convention (forward-to-aft).
  const columns = Array.from(new Set(numberedTanks.map((t) => t._num as number))).sort((a, b) => b - a);

  const portRow = columns.map((col) => numberedTanks.find((t) => t._num === col && t._side === "P") ?? null);
  const stbdRow = columns.map((col) => numberedTanks.find((t) => t._num === col && t._side === "S") ?? null);
  const centerRow = columns.map((col) => numberedTanks.find((t) => t._num === col && t._side === "C") ?? null);
  const hasCenter = centerRow.some((t) => t !== null);

  const cargoM3 = (t: VesselTank): number => {
    if (typeof t.capacity98 === "number") return t.capacity98;
    if (typeof t.capacity100 === "number") return t.capacity100 * 0.98;
    return 0;
  };
  const cargoMt = (t: VesselTank): number => {
    const product = getProduct(tankAssignments[t.name]);
    if (!product) return 0;
    return (cargoM3(t) * product.density) / 1000;
  };

  // Per-product breakdown — count of tanks, m³ and MT.
  const totalsByProduct = products.map((p) => {
    let count = 0;
    let m3 = 0;
    let mt = 0;
    for (const t of parsed) {
      if (tankAssignments[t.name] === p.id) {
        const tm3 = cargoM3(t);
        count += 1;
        m3 += tm3;
        mt += (tm3 * p.density) / 1000;
      }
    }
    return { product: p, count, m3, mt };
  });

  const totals = {
    // Theoretical max if every tank were filled at the "active product" density;
    // useful as a sanity benchmark against the assigned figure.
    totalM3: parsed.reduce((s, t) => s + cargoM3(t), 0),
    totalMt: parsed.reduce((s, t) => s + cargoMt(t), 0),
    selectedCount: Object.keys(tankAssignments).length,
    selectedM3: totalsByProduct.reduce((s, x) => s + x.m3, 0),
    selectedMt: totalsByProduct.reduce((s, x) => s + x.mt, 0),
  };

  // Adaptive width so chemical parcel tankers with 12+ tank pairs render
  // with readable cells. minColWidth picks a per-column budget; if it
  // doesn't fit the default 760 px, the SVG widens and the container
  // scrolls. For typical 6-pair MRs the SVG stays at 760 px (fits modal).
  const minColWidth = 65;
  const slopReserve = slopTanks.length > 0 ? 80 : 30;
  const svgWidth = Math.max(760, slopReserve + columns.length * minColWidth + 100);
  const svgHeight = 300;
  const margin = 24;
  const hullTop = margin;
  const hullBottom = svgHeight - margin;
  const sternX = margin;
  const bowX = svgWidth - margin;
  const hullHeight = hullBottom - hullTop;
  const bowTaper = 70;
  const gridSternX = sternX + (slopTanks.length > 0 ? 60 : 20);
  const gridBowX = bowX - bowTaper;
  const gridWidth = gridBowX - gridSternX;
  const colWidth = columns.length > 0 ? gridWidth / columns.length : 0;
  const rowCount = hasCenter ? 3 : 2;
  const rowHeight = (hullHeight - 16) / rowCount;
  const rowTop = (idx: number) => hullTop + 8 + idx * rowHeight;

  const maxM3 = Math.max(...parsed.map((x) => cargoM3(x)), 1);
  const productRgb = (p: StowageProduct | null) =>
    p ? PRODUCT_RGB[p.colorClass] ?? PRODUCT_RGB.cyan : null;

  const tankFill = (t: VesselTank) => {
    const product = getProduct(tankAssignments[t.name]);
    if (!product) return "var(--color-surface-3)";
    const intensity = Math.max(0.3, cargoM3(t) / maxM3);
    return `rgba(${productRgb(product)}, ${intensity * 0.6})`;
  };
  const tankStroke = (t: VesselTank) => {
    const product = getProduct(tankAssignments[t.name]);
    if (!product) return "var(--color-border-default)";
    return `rgb(${productRgb(product)})`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-8 overflow-auto">
      <div className="w-full max-w-5xl rounded-[var(--radius-lg)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-5 py-3">
          <div className="flex items-center gap-3">
            <Layers className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Stowage Planner — {linkage.vesselName ?? "TBN"}{" "}
              <span className="text-[var(--color-text-tertiary)] font-normal">
                (IMO {linkage.vesselImo ?? "—"})
              </span>
            </h3>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 text-xs text-[var(--color-text-secondary)]">
          <div className="grid grid-cols-6 gap-x-4 gap-y-1 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] px-3 py-2">
            <Kv label="DWT">
              {fmt(dwtCeiling, " MT")}
              {selectedLoadline && (
                <span className="text-[0.6rem] text-[var(--color-text-tertiary)] ml-1">
                  ({selectedLoadline.name})
                </span>
              )}
            </Kv>
            <Kv label="LOA">{fmt(particulars.loa, " m")}</Kv>
            <Kv label="Beam">{fmt(particulars.beam, " m")}</Kv>
            <Kv label="Draft">{fmt(selectedLoadline?.draft ?? particulars.summerDraft, " m")}</Kv>
            <Kv label="Tanks">{particulars.tankCount ?? tanks.length}</Kv>
            <Kv label="Coating">{particulars.coating ?? "—"}</Kv>
          </div>

          {/* Loadline selector — Q88 always lists several loadlines (Summer,
              Winter, Tropical, Fresh, Tropical Fresh) plus per-assigned-DWT
              rows on multi-SDWT vessels. The operator picks the one that
              applies to the current voyage zone / water density. */}
          {loadlines.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[0.65rem] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                Loadline:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {loadlines.map((l) => {
                  const active = l.name === selectedLoadlineName;
                  return (
                    <button
                      key={l.name}
                      onClick={() => setSelectedLoadlineName(l.name)}
                      className={`px-2 py-0.5 rounded-[var(--radius-sm)] text-[0.65rem] border transition-colors ${
                        active
                          ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300"
                          : "bg-[var(--color-surface-2)] border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-default)]"
                      }`}
                      title={`DWT ${fmt(l.dwt, " MT")}${l.draft ? ` · draft ${l.draft} m` : ""}`}
                    >
                      {l.name}{" "}
                      <span className={active ? "text-cyan-400" : "text-[var(--color-text-tertiary)]"}>
                        {fmt(l.dwt, " MT")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Products panel — multi-product stowage with per-product density.
              Click a row to arm that product, then click tanks in the SVG
              below to assign them. Same product re-clicked unassigns. */}
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[0.65rem] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                Products ({products.length}) · click a row to arm, then click tanks to assign
              </span>
              <button
                onClick={addProduct}
                className="text-[0.65rem] text-cyan-400 hover:text-cyan-300 px-2 py-0.5 rounded-[var(--radius-sm)] border border-cyan-500/30 hover:border-cyan-500/60"
              >
                + Add product
              </button>
            </div>
            <div className="space-y-1">
              {products.map((p) => {
                const isActive = p.id === activeProductId;
                const rgb = PRODUCT_RGB[p.colorClass] ?? PRODUCT_RGB.cyan;
                const totalRow =
                  totalsByProduct.find((x) => x.product.id === p.id) ??
                  { count: 0, m3: 0, mt: 0 };
                return (
                  <div
                    key={p.id}
                    onClick={() => setActiveProductId(p.id)}
                    className={`flex items-center gap-2 px-2 py-1 rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
                      isActive
                        ? "border-cyan-500/60 bg-cyan-500/10"
                        : "border-[var(--color-border-subtle)] hover:border-[var(--color-border-default)]"
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: `rgb(${rgb})` }}
                      title={isActive ? "Active — click tanks to assign" : "Click row to arm this product"}
                    />
                    <input
                      type="text"
                      value={p.name}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateProduct(p.id, { name: e.target.value })}
                      className="bg-transparent text-xs text-[var(--color-text-primary)] flex-1 min-w-0 focus:outline-none"
                    />
                    <input
                      type="number"
                      min={500}
                      max={1100}
                      step={1}
                      value={p.density}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateProduct(p.id, { density: Number(e.target.value) || 0 })}
                      className="bg-[var(--color-surface-1)] text-xs text-right w-16 px-1 py-0.5 border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] focus:outline-none focus:border-cyan-500/60"
                    />
                    <span className="text-[0.6rem] text-[var(--color-text-tertiary)] flex-shrink-0">
                      kg/m³
                    </span>
                    <span className="text-[0.65rem] text-[var(--color-text-secondary)] tabular-nums w-32 text-right flex-shrink-0">
                      {totalRow.count} tanks · {fmt(totalRow.mt, " MT")}
                    </span>
                    {products.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeProduct(p.id);
                        }}
                        className="text-[var(--color-text-tertiary)] hover:text-red-400 flex-shrink-0"
                        title="Remove product (its tanks become unassigned)"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-[0.6rem] text-[var(--color-text-tertiary)]">
              Density hints (kg/m³): RON95 gasoline ~735 · RON98 ~745 · Naphtha ~700 · ULSD ~835 · MTBE ~745 · Methanol ~792 · Toluene ~867 · Benzene ~876
            </div>
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-3 overflow-x-auto">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              style={{
                minWidth: svgWidth,
                width: "100%",
                height: "auto",
                maxHeight: 340,
                display: "block",
              }}
            >
              <path
                d={`M ${sternX} ${hullTop} L ${bowX - bowTaper} ${hullTop} Q ${bowX} ${hullTop + hullHeight / 2 - hullHeight * 0.25}, ${bowX} ${hullTop + hullHeight / 2} Q ${bowX} ${hullBottom - hullHeight * 0.25}, ${bowX - bowTaper} ${hullBottom} L ${sternX} ${hullBottom} Z`}
                fill="var(--color-surface-1)"
                stroke="var(--color-border-default)"
                strokeWidth={1.5}
              />
              <line
                x1={sternX + 4}
                y1={hullTop + hullHeight / 2}
                x2={bowX - 4}
                y2={hullTop + hullHeight / 2}
                stroke="var(--color-border-subtle)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <text x={sternX + 4} y={hullTop - 6} fontSize={9} fill="var(--color-text-tertiary)">STERN</text>
              <text x={bowX - 30} y={hullTop - 6} fontSize={9} fill="var(--color-text-tertiary)">BOW →</text>
              <text x={svgWidth / 2 - 10} y={hullTop - 6} fontSize={9} fill="var(--color-text-tertiary)">PORT</text>
              <text x={svgWidth / 2 - 20} y={hullBottom + 14} fontSize={9} fill="var(--color-text-tertiary)">STARBOARD</text>

              {slopTanks.map((t, i) => {
                const slopW = 40;
                const slopH = rowHeight - 4;
                const x = sternX + 8;
                const y = hullTop + 10 + i * (slopH + 4);
                return (
                  <g key={`slop-${i}`} onClick={() => toggleTank(t.name)} style={{ cursor: "pointer" }}>
                    <rect x={x} y={y} width={slopW} height={slopH} fill={tankFill(t)} stroke={tankStroke(t)} strokeWidth={1} rx={2} />
                    <text x={x + slopW / 2} y={y + slopH / 2 + 3} textAnchor="middle" fontSize={8} fill="var(--color-text-primary)">{t.name}</text>
                  </g>
                );
              })}

              {columns.map((colNum, ci) => {
                const x = gridSternX + ci * colWidth + 2;
                const w = colWidth - 4;
                const pt = portRow[ci];
                const ct = centerRow[ci];
                const st = stbdRow[ci];
                return (
                  <g key={`col-${colNum}`}>
                    {pt && (
                      <g onClick={() => toggleTank(pt.name)} style={{ cursor: "pointer" }}>
                        <rect x={x} y={rowTop(0)} width={w} height={rowHeight - 4} fill={tankFill(pt)} stroke={tankStroke(pt)} strokeWidth={1} rx={2} />
                        <text x={x + w / 2} y={rowTop(0) + (rowHeight - 4) / 2 - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--color-text-primary)">{pt.name}</text>
                        <text x={x + w / 2} y={rowTop(0) + (rowHeight - 4) / 2 + 10} textAnchor="middle" fontSize={8} fill="var(--color-text-secondary)">{fmt(cargoMt(pt), " MT")}</text>
                      </g>
                    )}
                    {hasCenter && ct && (
                      <g onClick={() => toggleTank(ct.name)} style={{ cursor: "pointer" }}>
                        <rect x={x} y={rowTop(1)} width={w} height={rowHeight - 4} fill={tankFill(ct)} stroke={tankStroke(ct)} strokeWidth={1} rx={2} />
                        <text x={x + w / 2} y={rowTop(1) + (rowHeight - 4) / 2 - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--color-text-primary)">{ct.name}</text>
                        <text x={x + w / 2} y={rowTop(1) + (rowHeight - 4) / 2 + 10} textAnchor="middle" fontSize={8} fill="var(--color-text-secondary)">{fmt(cargoMt(ct), " MT")}</text>
                      </g>
                    )}
                    {st && (
                      <g onClick={() => toggleTank(st.name)} style={{ cursor: "pointer" }}>
                        <rect x={x} y={rowTop(rowCount - 1)} width={w} height={rowHeight - 4} fill={tankFill(st)} stroke={tankStroke(st)} strokeWidth={1} rx={2} />
                        <text x={x + w / 2} y={rowTop(rowCount - 1) + (rowHeight - 4) / 2 - 4} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--color-text-primary)">{st.name}</text>
                        <text x={x + w / 2} y={rowTop(rowCount - 1) + (rowHeight - 4) / 2 + 10} textAnchor="middle" fontSize={8} fill="var(--color-text-secondary)">{fmt(cargoMt(st), " MT")}</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
            {otherTanks.length > 0 && (
              <div className="mt-2 text-[0.65rem] text-[var(--color-text-tertiary)]">
                Unmapped tanks (click to toggle):{" "}
                {otherTanks.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => toggleTank(t.name)}
                    className={`inline-block mx-1 px-1.5 py-0.5 rounded border ${
                      tankAssignments[t.name]
                        ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-300"
                        : "border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(() => {
              const overDwt =
                typeof dwtCeiling === "number" && totals.selectedMt > dwtCeiling;
              const nearDwt =
                typeof dwtCeiling === "number" &&
                !overDwt &&
                totals.selectedMt > dwtCeiling * 0.98;
              const borderCls = overDwt
                ? "border-red-500/60"
                : nearDwt
                ? "border-amber-500/60"
                : "border-[var(--color-border-subtle)]";
              const textCls = overDwt
                ? "text-red-400"
                : nearDwt
                ? "text-amber-400"
                : "text-[var(--color-text-primary)]";
              return (
                <div
                  className={`rounded-[var(--radius-md)] border ${borderCls} bg-[var(--color-surface-2)] px-3 py-2`}
                >
                  <span className="block text-[0.65rem] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                    Total assigned
                  </span>
                  <div className={`text-sm font-semibold mt-1 ${textCls}`}>
                    {fmt(totals.selectedMt, " MT")}
                  </div>
                  <div className="text-[0.65rem] text-[var(--color-text-tertiary)]">
                    {fmt(totals.selectedM3, " m³ @ 98%")} · {totals.selectedCount}/{tanks.length} tanks ·{" "}
                    {products.length} product{products.length === 1 ? "" : "s"}
                  </div>
                  {overDwt && (
                    <div className="text-[0.65rem] text-red-400 mt-1">
                      Exceeds {selectedLoadline?.name ?? "DWT"} by{" "}
                      {fmt(totals.selectedMt - (dwtCeiling ?? 0), " MT")}
                    </div>
                  )}
                  {nearDwt && (
                    <div className="text-[0.65rem] text-amber-400 mt-1">
                      Within 2% of {selectedLoadline?.name ?? "DWT"} ceiling
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-2">
              <span className="block text-[0.65rem] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                Max capacity (vessel)
              </span>
              <div className="text-sm font-semibold text-[var(--color-text-primary)] mt-1">
                {fmt(totals.totalMt, " MT")}
              </div>
              <div className="text-[0.65rem] text-[var(--color-text-tertiary)]">
                {fmt(totals.totalM3, " m³ @ 98%")} · all tanks at currently assigned densities
              </div>
            </div>
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-1.5">
              <span className="text-[0.65rem] uppercase tracking-wide text-[var(--color-text-tertiary)]">
                Tank breakdown
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    setTankAssignments(
                      Object.fromEntries(tanks.map((t) => [t.name, activeProductId]))
                    )
                  }
                  className="text-[0.65rem] text-cyan-400 hover:text-cyan-300"
                  title="Assign every tank to the currently armed product"
                >
                  Assign all to active
                </button>
                <button
                  onClick={() => setTankAssignments({})}
                  className="text-[0.65rem] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  Unassign all
                </button>
              </div>
            </div>
            <table className="w-full text-[0.7rem]">
              <thead className="text-[var(--color-text-tertiary)]">
                <tr>
                  <th className="text-left px-2 py-1 font-normal">Tank</th>
                  <th className="text-left px-2 py-1 font-normal">Product</th>
                  <th className="text-right px-2 py-1 font-normal">100% (m³)</th>
                  <th className="text-right px-2 py-1 font-normal">98% (m³)</th>
                  <th className="text-right px-2 py-1 font-normal">Cargo (MT)</th>
                  <th className="text-left px-2 py-1 font-normal">Coating</th>
                </tr>
              </thead>
              <tbody>
                {tanks.map((t, i) => {
                  const product = getProduct(tankAssignments[t.name]);
                  const rgb = product
                    ? PRODUCT_RGB[product.colorClass] ?? PRODUCT_RGB.cyan
                    : null;
                  return (
                    <tr key={i} className="border-t border-[var(--color-border-subtle)]">
                      <td className="px-2 py-1 font-medium">{t.name}</td>
                      <td className="px-2 py-1">
                        <select
                          value={tankAssignments[t.name] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setTankAssignments((prev) => {
                              const next = { ...prev };
                              if (v === "") delete next[t.name];
                              else next[t.name] = v;
                              return next;
                            });
                          }}
                          className="bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] px-1 py-0.5 text-[0.65rem] focus:outline-none focus:border-cyan-500/60"
                          style={rgb ? { color: `rgb(${rgb})` } : undefined}
                        >
                          <option value="">— unassigned —</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-right">{fmt(t.capacity100)}</td>
                      <td className="px-2 py-1 text-right">
                        {fmt(t.capacity98 ?? (t.capacity100 ? t.capacity100 * 0.98 : null))}
                      </td>
                      <td
                        className={`px-2 py-1 text-right ${
                          product ? "font-medium" : "text-[var(--color-text-tertiary)]"
                        }`}
                        style={product && rgb ? { color: `rgb(${rgb})` } : undefined}
                      >
                        {fmt(cargoMt(t))}
                      </td>
                      <td className="px-2 py-1 text-[var(--color-text-tertiary)]">{t.coating ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
