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
import { toast } from "sonner";
import {
  ArrowLeft,
  Pencil,
  Plus,
  Link2,
  Ship,
  Package,
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
  Play,
  Waves,
  CircleDot,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

// ── Types ────────────────────────────────────────────────────

interface LinkageData {
  id: string;
  linkageNumber: string | null;
  tempName: string;
  status: string;
  vesselName: string | null;
  vesselImo: string | null;
  assignedOperatorId: string | null;
  secondaryOperatorId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
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
  const buyDeals = deals.filter((d) => d.direction === "buy");
  const sellDeals = deals.filter((d) => d.direction === "sell");
  const buyTotal = deals.filter((d) => d.direction === "buy").reduce((s, d) => s + parseFloat(d.quantityMt || "0"), 0);
  const sellTotal = deals.filter((d) => d.direction === "sell").reduce((s, d) => s + parseFloat(d.quantityMt || "0"), 0);

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
          <LinkageStatusStepper linkageId={linkage.id} status={linkage.status} canEdit={isOperator} onUpdated={fetchData} />
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
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-500/60" />
            Purchase / Load
            <span className="text-xs font-normal text-[var(--color-text-tertiary)] ml-1">
              ({buyDeals.length})
            </span>
          </h2>
          {buyDeals.length === 0 ? (
            isOperator ? (
              <AddDealMenu linkageId={linkage.id} linkageCode={displayName} variant="placeholder" side="buy" />
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] py-8 text-center">
                <p className="text-sm text-[var(--color-text-tertiary)]">No purchases yet</p>
              </div>
            )
          ) : (
            <>
              {buyDeals.map((d) => <DealCard key={d.id} deal={d} steps={workflows[d.id] ?? []} onDeleted={fetchData} canDelete={isOperator} />)}
              {isOperator && (
                <AddDealMenu linkageId={linkage.id} linkageCode={displayName} variant="compact" side="buy" />
              )}
            </>
          )}
        </div>

        {/* Sell side */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500/60" />
            Sale / Discharge
            <span className="text-xs font-normal text-[var(--color-text-tertiary)] ml-1">
              ({sellDeals.length})
            </span>
          </h2>
          {sellDeals.length === 0 ? (
            isOperator ? (
              <AddDealMenu linkageId={linkage.id} linkageCode={displayName} variant="placeholder" side="sell" />
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] py-8 text-center">
                <p className="text-sm text-[var(--color-text-tertiary)]">No sales yet</p>
              </div>
            )
          ) : (
            <>
              {sellDeals.map((d) => <DealCard key={d.id} deal={d} steps={workflows[d.id] ?? []} onDeleted={fetchData} canDelete={isOperator} />)}
              {isOperator && (
                <AddDealMenu linkageId={linkage.id} linkageCode={displayName} variant="compact" side="sell" />
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
    setSavingVessel(true);
    const res = await fetch(`/api/linkages/${linkage.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vesselName: vesselDraft.trim() || null, vesselImo: imoDraft.trim() || null }),
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
            <button onClick={saveVessel} disabled={savingVessel} className="p-1 text-[var(--color-success)] hover:bg-[var(--color-surface-3)] rounded cursor-pointer disabled:opacity-50">
              {savingVessel ? <div className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => setEditingVessel(false)} disabled={savingVessel} className="p-1 text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-3)] rounded cursor-pointer disabled:opacity-50">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button onClick={canEdit ? () => { setVesselDraft(linkage.vesselName ?? ""); setImoDraft(linkage.vesselImo ?? ""); setEditingVessel(true); } : undefined} disabled={!canEdit}
            className={`flex items-center gap-2 ${canEdit ? "cursor-pointer hover:bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] px-2 py-1 -mx-2 -my-1 transition-colors" : "cursor-default"}`}
            title={canEdit ? "Click to edit vessel" : undefined}>
            <Ship className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">{linkage.vesselName || "TBN"}</span>
            {linkage.vesselImo && <span className="text-xs font-mono text-[var(--color-text-tertiary)] ml-1">IMO {linkage.vesselImo}</span>}
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

// ── Status Toggle ────────────────────────────────────────────

const LINKAGE_STATUS_STEPS: Array<{ status: string; label: string; icon: React.ElementType }> = [
  { status: "active",      label: "Active",      icon: Play },
  { status: "loading",     label: "Loading",     icon: Package },
  { status: "sailing",     label: "Sailing",     icon: Ship },
  { status: "discharging", label: "Discharging", icon: Waves },
  { status: "completed",   label: "Completed",   icon: CheckCircle2 },
];

const NEXT_LINKAGE_STATUS: Record<string, string> = {
  active:      "loading",
  loading:     "sailing",
  sailing:     "discharging",
  discharging: "completed",
};

const PREV_LINKAGE_STATUS: Record<string, string> = {
  loading:     "active",
  sailing:     "loading",
  discharging: "sailing",
  completed:   "discharging",
};

function LinkageStatusStepper({ linkageId, status, canEdit, onUpdated }: {
  linkageId: string; status: string; canEdit: boolean; onUpdated: () => void;
}) {
  const [advancing, setAdvancing] = useState(false);
  const currentIdx = LINKAGE_STATUS_STEPS.findIndex((s) => s.status === status);
  const nextStatus = NEXT_LINKAGE_STATUS[status];
  const prevStatus = PREV_LINKAGE_STATUS[status];

  const handleSetStatus = async (newStatus: string) => {
    if (!canEdit || advancing) return;
    setAdvancing(true);
    const res = await fetch(`/api/linkages/${linkageId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setAdvancing(false);
    if (res.ok) {
      toast.success(`Voyage status: ${newStatus}`);
      onUpdated();
    } else {
      toast.error("Failed to update status");
    }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {LINKAGE_STATUS_STEPS.map((step, idx) => {
        const Icon = step.icon;
        const isPast = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isNext = nextStatus === step.status;
        const isPrev = prevStatus === step.status;

        return (
          <div key={step.status} className="flex items-center gap-1.5">
            {idx > 0 && (
              <ChevronRight className={`h-3 w-3 flex-shrink-0 ${isPast || isCurrent ? "text-[var(--color-accent)]" : "text-[var(--color-border-subtle)]"}`} />
            )}
            <button
              onClick={(isNext || isPrev) && canEdit ? () => handleSetStatus(step.status) : undefined}
              disabled={(!isNext && !isPrev) || !canEdit || advancing}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                isCurrent
                  ? "bg-[var(--color-accent)] text-[var(--color-text-inverse)] shadow-sm"
                  : isPast
                  ? "bg-[var(--color-success-muted)] text-[var(--color-success)] cursor-pointer hover:opacity-80"
                  : isNext && canEdit
                  ? "bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-muted)] hover:text-[var(--color-accent-text)] cursor-pointer border border-dashed border-[var(--color-border-default)]"
                  : "bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)] cursor-default opacity-50"
              }`}
            >
              {isCurrent && advancing ? (
                <div className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              ) : (
                <Icon className="h-3 w-3" />
              )}
              {step.label}
            </button>
          </div>
        );
      })}
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
    for (const file of files) {
      try {
        await fetch(`/api/linkages/${linkage.id}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, fileType: "q88" }),
        });
      } catch { /* silent */ }
    }
    setUploading(false);
    toast.success(`Q88 uploaded: ${files.map((f) => f.name).join(", ")}`);
    onUpdated();
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
    for (const file of files) {
      try {
        await fetch(`/api/linkages/${linkage.id}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, fileType: "cp_recap" }),
        });
      } catch { /* silent */ }
    }
    setUploadingCp(false);
    toast.success(`CP Recap uploaded: ${files.map((f) => f.name).join(", ")}`);
    onUpdated();
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
                    {d.filename}
                  </div>
                ))}
                <p className="text-[0.65rem] text-[var(--color-text-tertiary)]">Drop to replace Q88</p>
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
                    {d.filename}
                  </div>
                ))}
                <p className="text-[0.65rem] text-[var(--color-text-tertiary)]">Drop to replace CP Recap</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <Upload className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                <p className="text-xs text-[var(--color-text-tertiary)]">Drop CP Recap here</p>
              </div>
            )}
          </div>

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
    </Card>
  );
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

  return (
    <>
      <Card className={`border-l-[3px] ${borderColor}`}>
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <Link href={`/deals/${deal.id}`} className="flex items-center gap-2 min-w-0 hover:underline">
            <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{deal.counterparty}</span>
            <Badge variant={deal.direction === "buy" ? "info" : "accent"} className="text-[0.6rem]">{deal.direction}</Badge>
            <span className="text-xs text-[var(--color-text-tertiary)]">{deal.incoterm}</span>
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
          <div><span className="text-[var(--color-text-tertiary)]">Qty:</span> {Number(deal.quantityMt).toLocaleString()} MT</div>
          <div><span className="text-[var(--color-text-tertiary)]">Loadport:</span> {deal.loadport}</div>
          {deal.dischargePort && <div><span className="text-[var(--color-text-tertiary)]">Discharge:</span> {deal.dischargePort}</div>}
          <div><span className="text-[var(--color-text-tertiary)]">Laycan:</span> {deal.laycanStart} — {deal.laycanEnd}</div>
        </div>
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

function AddDealMenu({ linkageId, linkageCode, side, variant }: {
  linkageId: string;
  linkageCode: string;
  side: "buy" | "sell";
  variant: "placeholder" | "compact";
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [terminalPicker, setTerminalPicker] = useState(false);
  const [terminals, setTerminals] = useState<TerminalParty[]>([]);
  const [loadingTerminals, setLoadingTerminals] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  const direction = side;
  const label = side === "buy" ? "Add purchase / loading" : "Add sale / discharge";
  const terminalLabel = side === "buy" ? "Load from own terminal" : "Discharge to own terminal";

  const openMenu = () => setMenuOpen(true);
  const closeAll = () => { setMenuOpen(false); setTerminalPicker(false); };

  const goParseEmail = () => {
    closeAll();
    router.push(`/deals/parse?linkageId=${encodeURIComponent(linkageId)}&linkageCode=${encodeURIComponent(linkageCode)}&direction=${direction}`);
  };

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

  const handleTerminalOperation = async (terminal: TerminalParty) => {
    setCreating(terminal.id);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const isBuy = side === "buy";
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterparty: `Own Terminal \u2014 ${terminal.name}`,
          direction,
          dealType: "terminal_operation",
          product: "Gasoline",
          quantityMt: 1,
          incoterm: "FOB",
          loadport: terminal.port ?? terminal.name,
          dischargePort: isBuy ? null : (terminal.port ?? terminal.name),
          laycanStart: today,
          laycanEnd: today,
          linkageId,
          linkageCode,
          specialInstructions: `${isBuy ? "Load from" : "Discharge to"} own terminal: ${terminal.name}`,
        }),
      });
      if (res.ok) {
        toast.success(`${isBuy ? "Load from" : "Discharge to"} ${terminal.name} created`);
        closeAll();
        // Trigger parent refetch
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

  // Terminal picker sub-view
  if (terminalPicker) {
    return (
      <div className="rounded-[var(--radius-md)] border-2 border-dashed border-teal-400/50 bg-teal-50/30 dark:bg-teal-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{terminalLabel}</span>
          <button onClick={closeAll} className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {loadingTerminals ? (
          <div className="flex justify-center py-4">
            <div className="h-4 w-4 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
          </div>
        ) : terminals.length === 0 ? (
          <p className="text-xs text-[var(--color-text-tertiary)] text-center py-4">No terminals found</p>
        ) : (
          <div className="space-y-1.5">
            {terminals.map((t) => (
              <button
                key={t.id}
                onClick={() => handleTerminalOperation(t)}
                disabled={creating === t.id}
                className="w-full text-left px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] hover:border-teal-500/40 hover:bg-teal-900/10 transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-between"
              >
                <div>
                  <div className="text-sm font-medium text-[var(--color-text-primary)]">{t.name}</div>
                  {t.port && <div className="text-xs text-[var(--color-text-tertiary)]">{t.port}</div>}
                </div>
                {creating === t.id && <div className="h-3 w-3 rounded-full border-2 border-teal-400 border-t-transparent animate-spin" />}
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
            className="rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--color-border-subtle)] py-10 flex flex-col items-center justify-center gap-3 hover:border-[var(--color-border-default)] hover:bg-[var(--color-surface-2)]/50 transition-colors cursor-pointer"
          >
            <div className="h-14 w-14 rounded-full bg-[var(--color-surface-3)] border border-[var(--color-border-default)] flex items-center justify-center group-hover:bg-[var(--color-surface-4)]">
              <Plus className="h-6 w-6 text-[var(--color-text-tertiary)]" />
            </div>
            <span className="text-sm text-[var(--color-text-tertiary)]">{label}</span>
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
