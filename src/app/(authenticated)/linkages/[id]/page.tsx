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

// ── Page ─────────────────────────────────────────────────────

export default function LinkageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const isOperator = session?.user?.role === "operator" || session?.user?.role === "admin";

  const [linkage, setLinkage] = useState<LinkageData | null>(null);
  const [deals, setDeals] = useState<DealSummary[]>([]);
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
    ])
      .then(([linkageData, dealsData]) => {
        setLinkage(linkageData);
        setDeals(dealsData.items ?? []);
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

  // Auto-refetch on visibility change
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
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
  const buyDeals = deals.filter((d) => d.direction === "buy" && d.dealType !== "terminal_operation");
  const sellDeals = deals.filter((d) => d.direction === "sell" && d.dealType !== "terminal_operation");
  const terminalDeals = deals.filter((d) => d.dealType === "terminal_operation");
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
          <StatusToggle linkageId={linkage.id} status={linkage.status} canEdit={isOperator} onToggled={fetchData} />
        </div>
      )}

      {/* Two-column grid: Buy + Sell */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Buy side */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-500/60" />
            Buy Side
            <span className="text-xs font-normal text-[var(--color-text-tertiary)] ml-1">
              ({buyDeals.length})
            </span>
          </h2>
          {buyDeals.length === 0 ? (
            isOperator ? (
              <AddDealPlaceholder linkageId={linkage.id} linkageCode={displayName} side="buy" />
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] py-8 text-center">
                <p className="text-sm text-[var(--color-text-tertiary)]">No purchases yet</p>
              </div>
            )
          ) : (
            <>
              {buyDeals.map((d) => <DealCard key={d.id} deal={d} onDeleted={fetchData} canDelete={isOperator} />)}
              {isOperator && (
                <AddDealButtons linkageId={linkage.id} linkageCode={displayName} side="buy" />
              )}
            </>
          )}
        </div>

        {/* Sell side */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500/60" />
            Sell Side
            <span className="text-xs font-normal text-[var(--color-text-tertiary)] ml-1">
              ({sellDeals.length})
            </span>
          </h2>
          {sellDeals.length === 0 ? (
            isOperator ? (
              <AddDealPlaceholder linkageId={linkage.id} linkageCode={displayName} side="sell" />
            ) : (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] py-8 text-center">
                <p className="text-sm text-[var(--color-text-tertiary)]">No sales yet</p>
              </div>
            )
          ) : (
            <>
              {sellDeals.map((d) => <DealCard key={d.id} deal={d} onDeleted={fetchData} canDelete={isOperator} />)}
              {isOperator && (
                <AddDealButtons linkageId={linkage.id} linkageCode={displayName} side="sell" />
              )}
            </>
          )}
        </div>
      </div>

      {/* Terminal operations */}
      {terminalDeals.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-teal-500/60" />
            Terminal Operations
            <span className="text-xs font-normal text-[var(--color-text-tertiary)] ml-1">
              ({terminalDeals.length})
            </span>
          </h2>
          {terminalDeals.map((d) => <DealCard key={d.id} deal={d} onDeleted={fetchData} canDelete={isOperator} />)}
        </div>
      )}
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
            <input placeholder="IMO" value={imoDraft} onChange={(e) => setImoDraft(e.target.value)} disabled={savingVessel}
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
        <div className="flex items-center gap-1.5">
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
        </div>
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

function StatusToggle({ linkageId, status, canEdit, onToggled }: {
  linkageId: string; status: string; canEdit: boolean; onToggled: () => void;
}) {
  const [toggling, setToggling] = useState(false);
  const toggle = async () => {
    if (!canEdit || toggling) return;
    setToggling(true);
    const res = await fetch(`/api/linkages/${linkageId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status === "active" ? "completed" : "active" }),
    });
    setToggling(false);
    if (res.ok) { toast.success(`Linkage marked ${status === "active" ? "completed" : "active"}`); onToggled(); }
    else toast.error("Failed to update status");
  };

  return (
    <button onClick={canEdit ? toggle : undefined} disabled={!canEdit || toggling}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-medium transition-colors ${
        status === "completed" ? "bg-green-900/30 text-green-400 border border-green-700/40" : "bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]"
      } ${canEdit ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
      title={canEdit ? `Click to mark ${status === "active" ? "completed" : "active"}` : undefined}>
      {toggling ? <div className="h-2 w-2 rounded-full border border-current border-t-transparent animate-spin" /> :
        <span className={`h-1.5 w-1.5 rounded-full ${status === "completed" ? "bg-green-400" : "bg-[var(--color-text-tertiary)]"}`} />}
      {status === "completed" ? "Completed" : "Active"}
    </button>
  );
}

// ── Deal Card ────────────────────────────────────────────────

function DealCard({ deal, onDeleted, canDelete }: { deal: DealSummary; onDeleted: () => void; canDelete: boolean }) {
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

// ── Add Deal Placeholder (large "+" for empty columns) ───────

function AddDealPlaceholder({ linkageId, linkageCode, side }: { linkageId: string; linkageCode: string; side: "buy" | "sell" }) {
  const router = useRouter();
  const label = side === "buy" ? "Add purchase / loading" : "Add sale / discharge";

  return (
    <div className="rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--color-border-subtle)] py-10 flex flex-col items-center justify-center gap-3 hover:border-[var(--color-border-default)] hover:bg-[var(--color-surface-2)]/50 transition-colors">
      <button
        onClick={() => router.push(`/deals/new?linkageId=${encodeURIComponent(linkageId)}&linkageCode=${encodeURIComponent(linkageCode)}&direction=${side}`)}
        className="h-14 w-14 rounded-full bg-[var(--color-surface-3)] border border-[var(--color-border-default)] flex items-center justify-center hover:bg-[var(--color-surface-4)] hover:border-[var(--color-accent)]/40 transition-all cursor-pointer group"
      >
        <Plus className="h-6 w-6 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-accent)]" />
      </button>
      <span className="text-sm text-[var(--color-text-tertiary)]">{label}</span>
      <div className="flex items-center gap-3 text-xs">
        <button
          onClick={() => router.push(`/deals/parse?linkageId=${encodeURIComponent(linkageId)}&linkageCode=${encodeURIComponent(linkageCode)}&direction=${side}`)}
          className="text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-text)] transition-colors cursor-pointer flex items-center gap-1"
        >
          <Plus className="h-3 w-3" /> Parse email
        </button>
        <span className="text-[var(--color-border-subtle)]">|</span>
        <button
          onClick={() => router.push(`/deals/new?linkageId=${encodeURIComponent(linkageId)}&linkageCode=${encodeURIComponent(linkageCode)}&direction=${side}`)}
          className="text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-text)] transition-colors cursor-pointer flex items-center gap-1"
        >
          <Plus className="h-3 w-3" /> Manual entry
        </button>
      </div>
    </div>
  );
}

// ── Add Deal Buttons (compact, for non-empty columns) ────────

function AddDealButtons({ linkageId, linkageCode, side }: { linkageId: string; linkageCode: string; side: "buy" | "sell" }) {
  const router = useRouter();
  const direction = side;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => router.push(`/deals/parse?linkageId=${encodeURIComponent(linkageId)}&linkageCode=${encodeURIComponent(linkageCode)}&direction=${direction}`)}
        className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-text)] transition-colors cursor-pointer"
      >
        <Plus className="h-3 w-3" /> Parse email
      </button>
      <span className="text-[var(--color-border-subtle)]">|</span>
      <button
        onClick={() => router.push(`/deals/new?linkageId=${encodeURIComponent(linkageId)}&linkageCode=${encodeURIComponent(linkageCode)}&direction=${direction}`)}
        className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-text)] transition-colors cursor-pointer"
      >
        <Plus className="h-3 w-3" /> Manual entry
      </button>
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
