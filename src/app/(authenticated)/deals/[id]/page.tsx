"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowLeft,
  Pencil,
  Clock,
  ArrowRightLeft,
  Play,
  CheckCircle2,
  Mail,
  Anchor,
  Send,
  Eye,
  AlertCircle,
  RefreshCw,
  GitBranch,
  Lock,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Zap,
  UserCheck,
  X,
  Save,
  Package,
  Ship,
  Waves,
  CircleDot,
  XCircle,
  Copy,
  ClipboardCheck,
  Plus,
  Link2,
  DollarSign,
  Users,
  FileText,
  Upload,
  Merge,
  Scissors,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import type { DealStatus, WorkflowStepStatus } from "@/lib/db/schema";
import type { WorkflowInstanceDetail, WorkflowStepWithDraft } from "@/lib/workflow-engine";

interface LinkageSummary {
  id: string;
  linkageNumber: string | null;
  tempName: string;
  status: string;
  dealCount: number;
}

interface LinkageDetail {
  id: string;
  linkageNumber: string | null;
  tempName: string;
  vesselName: string | null;
  vesselImo: string | null;
  assignedOperatorId: string | null;
  secondaryOperatorId: string | null;
  notes: string | null;
  status: string;
}

interface DealDetail {
  id: string;
  externalRef: string | null;
  linkageCode: string | null;
  linkageId: string | null;
  counterparty: string;
  direction: string;
  product: string;
  quantityMt: string;
  contractedQty: string | null;
  nominatedQty: string | null;
  incoterm: string;
  loadport: string;
  dischargePort: string;
  laycanStart: string;
  laycanEnd: string;
  vesselName: string | null;
  vesselImo: string | null;
  vesselCleared: boolean;
  docInstructionsReceived: boolean;
  status: DealStatus;
  pricingFormula: string | null;
  pricingType: string | null;
  pricingEstimatedDate: string | null;
  specialInstructions: string | null;
  secondaryOperatorId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  changeHistory: Array<{
    id: string;
    fieldChanged: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }>;
  auditLog: Array<{
    id: string;
    action: string;
    details: Record<string, unknown>;
    createdAt: string;
    userId: string | null;
    userName: string | null;
    userEmail: string | null;
  }>;
}

// ============================================================
// STATUS STEPPER
// ============================================================

const DEAL_STATUS_STEPS: Array<{ status: DealStatus; label: string; icon: React.ElementType }> = [
  { status: "draft",       label: "Draft",       icon: CircleDot },
  { status: "active",      label: "Active",      icon: Play },
  { status: "loading",     label: "Loading",     icon: Package },
  { status: "sailing",     label: "Sailing",     icon: Ship },
  { status: "discharging", label: "Discharging", icon: Waves },
  { status: "completed",   label: "Completed",   icon: CheckCircle2 },
];

const NEXT_STATUS: Partial<Record<DealStatus, DealStatus>> = {
  draft:       "active",
  active:      "loading",
  loading:     "sailing",
  sailing:     "discharging",
  discharging: "completed",
};

interface StatusStepperProps {
  status: DealStatus;
  version: number;
  dealId: string;
  canEdit: boolean;
  onAdvanced: () => void;
}

function StatusStepper({ status, version, dealId, canEdit, onAdvanced }: StatusStepperProps) {
  const [advancing, setAdvancing] = useState(false);

  const currentIdx = DEAL_STATUS_STEPS.findIndex((s) => s.status === status);
  const nextStatus = NEXT_STATUS[status];

  const handleAdvance = async () => {
    if (!nextStatus || advancing) return;
    setAdvancing(true);
    const res = await fetch(`/api/deals/${dealId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus, version }),
    });
    setAdvancing(false);
    if (res.ok) {
      onAdvanced();
    }
  };

  if (status === "cancelled") {
    return (
      <div className="flex items-center gap-2 py-2">
        <XCircle className="h-4 w-4 text-[var(--color-danger)]" />
        <span className="text-sm text-[var(--color-danger)] font-medium">Cancelled</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {DEAL_STATUS_STEPS.map((step, idx) => {
        const Icon = step.icon;
        const isPast = idx < currentIdx;
        const isCurrent = idx === currentIdx;
        const isNext = nextStatus === step.status;
        const isFuture = idx > currentIdx;

        return (
          <div key={step.status} className="flex items-center gap-1.5">
            {idx > 0 && (
              <ChevronRight className={`h-3 w-3 flex-shrink-0 ${isPast || isCurrent ? "text-[var(--color-accent)]" : "text-[var(--color-border-subtle)]"}`} />
            )}
            <button
              onClick={isNext && canEdit ? handleAdvance : undefined}
              disabled={!isNext || !canEdit || advancing}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                isCurrent
                  ? "bg-[var(--color-accent)] text-[var(--color-text-inverse)] shadow-sm"
                  : isPast
                  ? "bg-[var(--color-success-muted)] text-[var(--color-success)]"
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

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">
        {label}
      </dt>
      <dd className={`text-sm text-[var(--color-text-primary)] mt-0.5 ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </dd>
    </div>
  );
}

// ============================================================
// DEAL EXPORT DROPDOWN
// ============================================================

function DealExportDropdown({ dealId }: { dealId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleExport(format: string) {
    setOpen(false);
    const url = `/api/deals/export?format=${format}&search=${dealId}&perPage=1`;
    if (format === "pdf") {
      window.open(url, "_blank");
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
        <ArrowRightLeft className="h-3.5 w-3.5" />
        Export
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--color-surface-1)] border border-[var(--color-border-default)] rounded-[var(--radius-md)] shadow-lg py-1 min-w-[140px]">
          {(["csv", "xlsx", "pdf", "docx"] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => handleExport(fmt)}
              className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
            >
              {fmt === "csv" ? "CSV" : fmt === "xlsx" ? "Excel (.xlsx)" : fmt === "pdf" ? "PDF" : "Word (.docx)"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// STEP STATUS UI
// ============================================================

const STATUS_CONFIG: Record<
  WorkflowStepStatus,
  { label: string; color: string; icon: React.ElementType; dot: string }
> = {
  pending:         { label: "Pending",       color: "muted",   icon: Clock,         dot: "bg-[var(--color-text-tertiary)]" },
  blocked:         { label: "Blocked",       color: "muted",   icon: Lock,          dot: "bg-[var(--color-text-tertiary)]" },
  ready:           { label: "Ready",         color: "info",    icon: Zap,           dot: "bg-[var(--color-info)]" },
  draft_generated: { label: "Draft Ready",   color: "accent",  icon: Mail,          dot: "bg-[var(--color-accent)]" },
  sent:            { label: "Sent",          color: "success", icon: Send,          dot: "bg-[var(--color-success)]" },
  acknowledged:    { label: "Acknowledged",  color: "success", icon: CheckCircle2,  dot: "bg-[var(--color-success)]" },
  received:        { label: "Received",      color: "success", icon: CheckCircle2,  dot: "bg-[var(--color-success)]" },
  done:            { label: "Done",          color: "success", icon: CheckCircle2,  dot: "bg-[var(--color-success)]" },
  na:              { label: "N/A",           color: "muted",   icon: XCircle,       dot: "bg-[var(--color-text-tertiary)]" },
  cancelled:       { label: "Cancelled",     color: "danger",  icon: XCircle,       dot: "bg-[var(--color-danger)]" },
  needs_update:    { label: "Needs Update",  color: "danger",  icon: AlertCircle,   dot: "bg-[var(--color-danger)]" },
};

const STEP_TYPE_ICON: Record<string, React.ElementType> = {
  nomination:  Anchor,
  instruction: Mail,
  order:       Send,
  appointment: CheckCircle2,
};

const RECIPIENT_LABELS: Record<string, string> = {
  terminal:   "Terminal",
  agent:      "Agent",
  inspector:  "Inspector",
  broker:     "Broker / Counterparty",
};

interface Party {
  id: string;
  name: string;
  type: string;
  port: string | null;
  email: string | null;
}

// Terminal statuses where the prerequisite is considered "complete"
const PREREQUISITE_TERMINAL_STATUSES = new Set(["sent", "acknowledged", "received", "done"]);

interface WorkflowStepCardProps {
  step: WorkflowStepWithDraft;
  allSteps: WorkflowStepWithDraft[];
  onAction: (stepId: string, action: string, extra?: Record<string, unknown>) => Promise<void>;
  isOperator: boolean;
  loadport: string;
  dischargePort: string | null;
}

function WorkflowStepCard({ step, allSteps, onAction, isOperator, loadport, dischargePort }: WorkflowStepCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftEdits, setDraftEdits] = useState({ toAddresses: "", subject: "", body: "" });
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [matchedParties, setMatchedParties] = useState<Party[]>([]);
  const [restParties, setRestParties] = useState<Party[]>([]);
  const [showAllParties, setShowAllParties] = useState(false);
  const [loadingParties, setLoadingParties] = useState(false);
  const [showPrereqWarning, setShowPrereqWarning] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ action: string; extra?: Record<string, unknown> } | null>(null);

  const cfg = STATUS_CONFIG[step.status] ?? STATUS_CONFIG.pending;
  const TypeIcon = STEP_TYPE_ICON[step.stepType] ?? Mail;
  const isBlocked = step.status === "blocked" || step.status === "pending";
  const isDone = step.status === "acknowledged" || step.status === "done" || step.status === "na" || step.status === "cancelled" || (step.status === "sent" && !step.isExternalWait);
  const canAssignParty = isOperator && !isDone;

  // Check whether the prerequisite step (if any) has been completed
  const prereqStepName = step.recommendedAfterStepName ?? null;
  const prereqIncomplete = (() => {
    if (!prereqStepName) return false;
    const prereqId = step.recommendedAfter;
    if (!prereqId) return false;
    const prereqStep = allSteps.find((s) => s.id === prereqId);
    if (!prereqStep) return false;
    return !PREREQUISITE_TERMINAL_STATUSES.has(prereqStep.status);
  })();

  // Actions that should be gated by the prerequisite warning
  const GATED_ACTIONS = new Set(["generate_draft", "mark_sent"]);

  const handleAction = async (action: string, extra?: Record<string, unknown>) => {
    // If this is a gated action and prerequisite is incomplete, show warning
    if (GATED_ACTIONS.has(action) && prereqIncomplete) {
      setPendingAction({ action, extra });
      setShowPrereqWarning(true);
      return;
    }
    await executeAction(action, extra);
  };

  const executeAction = async (action: string, extra?: Record<string, unknown>) => {
    setLoading(true);
    try {
      await onAction(step.id, action, extra);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmPrereqOverride = async () => {
    setShowPrereqWarning(false);
    if (!pendingAction) return;
    // Execute the action with a flag indicating prerequisite was skipped
    await executeAction(pendingAction.action, {
      ...pendingAction.extra,
      skippedPrerequisite: prereqStepName,
    });
    setPendingAction(null);
  };

  const handleCancelPrereqWarning = () => {
    setShowPrereqWarning(false);
    setPendingAction(null);
  };

  const loadParties = async () => {
    if (matchedParties.length > 0 || restParties.length > 0) return;
    setLoadingParties(true);
    try {
      // Determine the relevant port for this step type
      // Discharge-side steps (agent/inspector at discharge) use dischargePort; loadport steps use loadport
      const stepNameLower = step.stepName.toLowerCase();
      const isDischargeStep = stepNameLower.includes("discharge") || stepNameLower.includes("disch");
      const port = isDischargeStep && dischargePort ? dischargePort : loadport;
      const params = new URLSearchParams({ type: step.recipientPartyType });
      if (port) params.set("port", port);
      const res = await fetch(`/api/parties?${params.toString()}`);
      const data = await res.json();
      setMatchedParties(data.matched ?? []);
      setRestParties(data.rest ?? []);
    } finally {
      setLoadingParties(false);
    }
  };

  const handlePartyChange = async (partyId: string) => {
    await handleAction("assign_party", { partyId: partyId || null });
  };

  const handleCopyDraft = async () => {
    if (!step.emailDraft) return;
    const text = `To: ${step.emailDraft.toAddresses}\nSubject: ${step.emailDraft.subject}\n\n${step.emailDraft.body}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openDraftEdit = () => {
    if (!step.emailDraft) return;
    setDraftEdits({
      toAddresses: step.emailDraft.toAddresses,
      subject: step.emailDraft.subject,
      body: step.emailDraft.body,
    });
    setEditingDraft(true);
    setDraftSaved(false);
  };

  const saveDraftEdit = async () => {
    if (!step.emailDraft) return;
    setSavingDraft(true);
    const res = await fetch(`/api/email-drafts/${step.emailDraft.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftEdits),
    });
    setSavingDraft(false);
    if (res.ok) {
      setDraftSaved(true);
      setEditingDraft(false);
      await onAction(step.id, "__refresh__");
    }
  };

  const hasExpandContent = step.emailDraft || step.description;

  return (
    <div
      className={`rounded-[var(--radius-md)] border transition-all ${
        isBlocked && step.status !== "needs_update"
          ? "border-[var(--color-border-subtle)] opacity-60"
          : isDone
          ? "border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]"
          : step.status === "needs_update"
          ? "border-[var(--color-danger)] bg-[var(--color-surface-2)]"
          : "border-[var(--color-border-default)] bg-[var(--color-surface-2)]"
      }`}
    >
      {/* Step header — two rows: top = icon+name+status+actions, bottom = metadata */}
      <div className="p-3 space-y-1.5">
        {/* Row 1: icon + name + right-aligned status & actions */}
        <div className="flex items-center gap-2">
          {/* Step type icon */}
          <div
            className={`h-7 w-7 rounded-[var(--radius-sm)] flex items-center justify-center flex-shrink-0 ${
              isDone
                ? "bg-[var(--color-success-muted)]"
                : step.status === "needs_update"
                ? "bg-[var(--color-danger-muted,#3d1515)]"
                : isBlocked
                ? "bg-[var(--color-surface-3)]"
                : "bg-[var(--color-accent-muted)]"
            }`}
          >
            <TypeIcon
              className={`h-3.5 w-3.5 ${
                isDone
                  ? "text-[var(--color-success)]"
                  : step.status === "needs_update"
                  ? "text-[var(--color-danger)]"
                  : isBlocked
                  ? "text-[var(--color-text-tertiary)]"
                  : "text-[var(--color-accent)]"
              }`}
            />
          </div>

          {/* Step name */}
          <span
            className={`text-sm font-medium truncate flex-1 min-w-0 ${
              isBlocked ? "text-[var(--color-text-tertiary)]" : "text-[var(--color-text-primary)]"
            }`}
          >
            {step.stepName}
          </span>

          {/* Right side: status badge + action + expand — always right-aligned */}
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
            {step.isExternalWait && (
              <span className="text-[0.5rem] font-mono px-1 py-0.5 rounded bg-[var(--color-info-muted)] text-[var(--color-info)] uppercase tracking-wider">
                Ext.
              </span>
            )}
            <Badge variant={cfg.color as any} dot>
              {cfg.label}
            </Badge>
          </div>
        </div>

        {/* Row 2: metadata + action buttons */}
        <div className="flex items-center gap-2 pl-9">
          <span className="text-xs text-[var(--color-text-tertiary)]">
            → {RECIPIENT_LABELS[step.recipientPartyType] ?? step.recipientPartyType}
          </span>
            {step.assignedPartyName && (
              <span className="text-xs text-[var(--color-accent-text)] font-medium">
                {step.assignedPartyName}
                {step.assignedPartyEmail && (
                  <span className="text-[var(--color-text-tertiary)] font-normal ml-1 font-mono">
                    &lt;{step.assignedPartyEmail}&gt;
                  </span>
                )}
              </span>
            )}
            {step.status === "needs_update" && (
              <span className="text-xs text-[var(--color-danger)]">· re-send required</span>
            )}

            {/* Action buttons — right-aligned in the metadata row */}
            <div className="flex items-center gap-1 ml-auto">
              {isOperator && !isBlocked && (
                <>
                  {(step.status === "ready" || step.status === "needs_update") && step.emailTemplateId && (
                    <Button variant="secondary" size="sm" onClick={() => handleAction("generate_draft")} disabled={loading} data-tour="generate-draft">
                      <Mail className="h-3 w-3" />
                      Draft
                    </Button>
                  )}
                  {/* V1: Allow marking as sent directly — operator sends via Outlook outside the program */}
                  {(step.status === "ready" || step.status === "draft_generated" || step.status === "needs_update") && (
                    <Button variant="primary" size="sm" onClick={() => handleAction("mark_sent")} disabled={loading}>
                      <Send className="h-3 w-3" />
                      {step.status === "needs_update" ? "Re-sent" : "Sent"}
                    </Button>
                  )}
                  {step.status === "sent" && step.isExternalWait && (
                    <Button variant="secondary" size="sm" onClick={() => handleAction("mark_acknowledged")} disabled={loading}>
                      <CheckCircle2 className="h-3 w-3" />
                      Received
                    </Button>
                  )}
                </>
              )}

              {/* Expand toggle */}
              {hasExpandContent && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  data-tour={step.emailDraft != null ? "expand-draft" : undefined}
                  className="p-1 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] transition-colors"
                >
                  {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          </div>
        </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)] px-3 pb-3 pt-2 space-y-3">
          {/* Party picker */}
          {canAssignParty && (
            <div className="flex items-center gap-2">
              <UserCheck className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] flex-shrink-0" />
              <span className="text-[0.6875rem] text-[var(--color-text-tertiary)] uppercase tracking-wide font-medium flex-shrink-0">
                Assign Party
              </span>
              <select
                className="flex-1 text-xs h-7 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] px-2 outline-none focus:border-[var(--color-border-default)] transition-colors"
                value={step.assignedPartyId ?? ""}
                onChange={(e) => handlePartyChange(e.target.value)}
                onFocus={loadParties}
                disabled={loading}
              >
                <option value="">— Select {RECIPIENT_LABELS[step.recipientPartyType] ?? step.recipientPartyType} —</option>
                {loadingParties && <option disabled>Loading...</option>}
                {matchedParties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.port ? ` (${p.port})` : ""}
                  </option>
                ))}
                {showAllParties && restParties.length > 0 && (
                  <>
                    <option disabled>── Other ──</option>
                    {restParties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.port ? ` (${p.port})` : ""}
                      </option>
                    ))}
                  </>
                )}
              </select>
              {restParties.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setShowAllParties(!showAllParties); loadParties(); }}
                  className="text-[0.625rem] text-[var(--color-accent-text)] hover:underline whitespace-nowrap flex-shrink-0"
                >
                  {showAllParties ? "Region only" : `Show all (${restParties.length})`}
                </button>
              )}
            </div>
          )}

          {step.description && (
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              {step.description}
            </p>
          )}

          {step.emailDraft && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--color-border-default)] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-surface-3)] border-b border-[var(--color-border-subtle)]">
                <Eye className="h-3 w-3 text-[var(--color-text-tertiary)]" />
                <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                  Email Draft
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <Badge variant={step.emailDraft.status === "sent" ? "success" : "muted"}>
                    {step.emailDraft.status}
                  </Badge>
                  <button
                    onClick={handleCopyDraft}
                    title="Copy draft to clipboard"
                    className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-text)] transition-colors px-1.5 py-0.5 rounded hover:bg-[var(--color-accent-muted)] flex items-center gap-1"
                  >
                    {copied ? (
                      <><ClipboardCheck className="h-3 w-3 text-[var(--color-success)]" />Copied</>
                    ) : (
                      <><Copy className="h-3 w-3" />Copy</>
                    )}
                  </button>
                  {isOperator && step.emailDraft.status !== "sent" && !editingDraft && (
                    <button
                      onClick={openDraftEdit}
                      className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-text)] transition-colors px-1.5 py-0.5 rounded hover:bg-[var(--color-accent-muted)]"
                    >
                      Edit
                    </button>
                  )}
                  {editingDraft && (
                    <>
                      <button
                        onClick={saveDraftEdit}
                        disabled={savingDraft}
                        className="text-[0.625rem] font-mono text-[var(--color-success)] hover:text-[var(--color-success)] transition-colors px-1.5 py-0.5 rounded hover:bg-[var(--color-success-muted)]"
                      >
                        <Save className="h-3 w-3 inline mr-0.5" />
                        {savingDraft ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingDraft(false)}
                        className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] transition-colors px-1 py-0.5 rounded"
                      >
                        <X className="h-3 w-3 inline" />
                      </button>
                    </>
                  )}
                </span>
              </div>
              <div className="p-3 space-y-2">
                {editingDraft ? (
                  <>
                    <div>
                      <label className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] uppercase tracking-wide">To</label>
                      <input
                        type="text"
                        value={draftEdits.toAddresses}
                        onChange={(e) => setDraftEdits((d) => ({ ...d, toAddresses: e.target.value }))}
                        className="w-full mt-0.5 text-xs font-mono h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-default)] transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] uppercase tracking-wide">Subject</label>
                      <input
                        type="text"
                        value={draftEdits.subject}
                        onChange={(e) => setDraftEdits((d) => ({ ...d, subject: e.target.value }))}
                        className="w-full mt-0.5 text-xs h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-default)] transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] uppercase tracking-wide">Body</label>
                      <textarea
                        value={draftEdits.body}
                        onChange={(e) => setDraftEdits((d) => ({ ...d, body: e.target.value }))}
                        rows={8}
                        className="w-full mt-0.5 text-xs font-mono p-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-default)] resize-y transition-colors leading-relaxed"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] uppercase tracking-wide">To</span>
                      <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 font-mono">
                        {step.emailDraft.toAddresses}
                      </p>
                    </div>
                    <div>
                      <span className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] uppercase tracking-wide">Subject</span>
                      <p className="text-xs font-medium text-[var(--color-text-primary)] mt-0.5">
                        {step.emailDraft.subject}
                      </p>
                    </div>
                    <div>
                      <span className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] uppercase tracking-wide">Body</span>
                      <pre className="text-xs text-[var(--color-text-secondary)] mt-0.5 whitespace-pre-wrap font-mono leading-relaxed bg-[var(--color-surface-0)] p-2 rounded-[var(--radius-sm)] max-h-48 overflow-y-auto">
                        {step.emailDraft.body}
                      </pre>
                    </div>
                  </>
                )}
                {draftSaved && (
                  <p className="text-xs text-[var(--color-success)]">Draft saved.</p>
                )}
              </div>
            </div>
          )}

          {/* Secondary actions: N/A + Cancel — only in expanded view */}
          {isOperator && (
            <div className="flex items-center gap-2 pt-1 border-t border-[var(--color-border-subtle)]">
              {(step.status === "ready" || step.status === "pending") && (
                <button
                  onClick={() => handleAction("mark_na")}
                  disabled={loading}
                  className="text-[0.625rem] font-mono px-2 py-1 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-50"
                >
                  Mark as N/A
                </button>
              )}
              {step.status !== "cancelled" && step.status !== "done" && step.status !== "na" && step.status !== "acknowledged" && step.status !== "received" && (
                <button
                  onClick={() => handleAction("mark_cancelled")}
                  disabled={loading}
                  className="text-[0.625rem] font-mono px-2 py-1 rounded text-[var(--color-danger)] hover:bg-[var(--color-danger-muted,#3d1515)] transition-colors disabled:opacity-50"
                >
                  Cancel step
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Prerequisite warning dialog */}
      <Dialog
        open={showPrereqWarning}
        onClose={handleCancelPrereqWarning}
        title="Prerequisite Not Complete"
      >
        <p className="text-sm text-[var(--color-text-secondary)] mb-5">
          Warning: <strong>{prereqStepName}</strong> has not been completed yet. Proceed anyway?
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={handleCancelPrereqWarning}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleConfirmPrereqOverride}>
            Send Anyway
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

// ============================================================
// WORKFLOW SECTION
// ============================================================

interface WorkflowSectionProps {
  dealId: string;
  dealStatus: DealStatus;
  isOperator: boolean;
  loadport: string;
  dischargePort: string | null;
}

function WorkflowSection({ dealId, dealStatus, isOperator, loadport, dischargePort }: WorkflowSectionProps) {
  const [workflow, setWorkflow] = useState<WorkflowInstanceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCompletePrompt, setShowCompletePrompt] = useState(false);

  const fetchWorkflow = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}/workflow`);
    const data = await res.json();
    setWorkflow(data.workflow ?? null);
    setLoading(false);
  }, [dealId]);

  useEffect(() => {
    fetchWorkflow();
  }, [fetchWorkflow]);

  const createWorkflow = async () => {
    setCreating(true);
    setError(null);
    const res = await fetch(`/api/deals/${dealId}/workflow`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to start workflow");
    } else {
      setWorkflow(data.workflow);
    }
    setCreating(false);
  };

  const handleStepAction = async (stepId: string, action: string, extra?: Record<string, unknown>) => {
    if (action === "__refresh__") {
      await fetchWorkflow();
      return;
    }
    const res = await fetch(`/api/workflows/steps/${stepId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.workflowCompleted) setShowCompletePrompt(true);

      // Toast based on email send result
      if (action === "generate_draft") {
        toast.success("Draft generated — review before sending");
      }
      if (action === "mark_sent") {
        toast.success("Marked as sent");
      }
      if (action === "mark_done") {
        toast.success("Step completed");
      }
      if (action === "mark_cancelled") {
        toast.info("Step cancelled");
      }
      if (action === "mark_na") {
        toast.info("Marked as N/A");
      }

      await fetchWorkflow();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Action failed");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!workflow) {
    const canStart = isOperator && dealStatus !== "draft" && dealStatus !== "cancelled" && dealStatus !== "completed";
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
        <div className="h-10 w-10 rounded-full bg-[var(--color-surface-3)] flex items-center justify-center">
          <GitBranch className="h-5 w-5 text-[var(--color-text-tertiary)]" />
        </div>
        <div>
          <p className="text-sm text-[var(--color-text-secondary)]">No workflow started yet</p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {dealStatus === "draft"
              ? "Activate the deal to start a workflow"
              : "Match a workflow template to this deal"}
          </p>
        </div>
        {canStart && (
          <Button variant="primary" size="sm" onClick={createWorkflow} disabled={creating}>
            <Play className="h-3 w-3" />
            {creating ? "Starting…" : "Start Workflow"}
          </Button>
        )}
        {error && (
          <p className="text-xs text-[var(--color-danger)]">{error}</p>
        )}
      </div>
    );
  }

  const completedCount = workflow.steps.filter(
    (s) => s.status === "sent" || s.status === "acknowledged" || s.status === "done" || s.status === "na" || s.status === "cancelled" || s.status === "received"
  ).length;
  const totalCount = workflow.steps.length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Workflow complete banner */}
      {showCompletePrompt && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-md)] bg-[var(--color-success-muted)] border border-[var(--color-success)]">
          <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--color-success)]">All workflow steps complete</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              All communications have been sent. You can now advance the deal status.
            </p>
          </div>
          <button
            onClick={() => setShowCompletePrompt(false)}
            className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-[var(--color-surface-3)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="text-xs font-mono text-[var(--color-text-tertiary)] flex-shrink-0">
          {completedCount}/{totalCount} steps
        </span>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {workflow.steps.map((step, idx) => (
          <div key={step.id} className="flex gap-2">
            {/* Step number indicator */}
            <div className="flex flex-col items-center flex-shrink-0 pt-2.5">
              <div
                className={`h-5 w-5 rounded-full flex items-center justify-center text-[0.625rem] font-bold ${
                  step.status === "acknowledged" || (step.status === "sent" && !step.isExternalWait)
                    ? "bg-[var(--color-success)] text-white"
                    : step.status === "blocked"
                    ? "bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)]"
                    : step.status === "ready" || step.status === "draft_generated"
                    ? "bg-[var(--color-accent)] text-[var(--color-text-inverse)]"
                    : "bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)]"
                }`}
              >
                {idx + 1}
              </div>
              {idx < workflow.steps.length - 1 && (
                <div className="w-px flex-1 min-h-2 bg-[var(--color-border-subtle)] mt-1" />
              )}
            </div>

            <div className="flex-1 pb-2">
              <WorkflowStepCard
                step={step}
                allSteps={workflow.steps}
                onAction={(sid, action, extra) => handleStepAction(sid, action, extra)}
                isOperator={isOperator}
                loadport={loadport}
                dischargePort={dischargePort}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// LINKED DEAL TYPE (from list API)
// ============================================================

interface LinkedDeal {
  id: string;
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
  vesselImo: string | null;
  status: DealStatus;
  pricingType: string | null;
  pricingFormula: string | null;
  pricingEstimatedDate: string | null;
  assignedOperatorId: string | null;
  secondaryOperatorId: string | null;
  loadedQuantityMt: string | null;
  version: number;
  createdAt: string;
}

// ============================================================
// VOYAGE INFO BAR (top of linkage view)
// ============================================================

function VoyageInfoBar({
  linkageCode,
  linkageId,
  vesselName,
  vesselImo,
  product,
  assignedOperatorId,
  secondaryOperatorId,
  pricingType,
  pricingFormula,
  pricingEstimatedDate,
  canEdit,
  onVesselUpdated,
}: {
  linkageCode: string;
  linkageId: string | null;
  vesselName: string | null;
  vesselImo: string | null;
  product: string;
  assignedOperatorId: string | null;
  secondaryOperatorId: string | null;
  pricingType: string | null;
  pricingFormula: string | null;
  pricingEstimatedDate: string | null;
  canEdit: boolean;
  onVesselUpdated: () => void;
}) {
  // Operator list + name cache for proper initials display
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    if (!canEdit) return;
    fetch("/api/users?role=operator")
      .then((r) => r.json())
      .then((data) => setOperators(data.users ?? []))
      .catch(() => setOperators([]));
  }, [canEdit]);

  const operatorInitials = (id: string | null) => {
    if (!id) return null;
    const user = operators.find((u) => u.id === id);
    if (user?.name) {
      return user.name
        .split(/\s+/)
        .map((n) => n[0]?.toUpperCase() ?? "")
        .join("")
        .slice(0, 2);
    }
    return id.substring(0, 2).toUpperCase();
  };

  const [editing, setEditing] = useState(false);
  const [vesselNameDraft, setVesselNameDraft] = useState(vesselName ?? "");
  const [vesselImoDraft, setVesselImoDraft] = useState(vesselImo ?? "");
  const [savingVessel, setSavingVessel] = useState(false);

  // Linkage number editor state
  const [editingLinkage, setEditingLinkage] = useState(false);
  const [linkageNumberDraft, setLinkageNumberDraft] = useState(linkageCode ?? "");
  const [savingLinkage, setSavingLinkage] = useState(false);

  // Operator editor state
  const [editingOperators, setEditingOperators] = useState(false);
  const [primaryOperatorDraft, setPrimaryOperatorDraft] = useState(assignedOperatorId ?? "");
  const [secondaryOperatorDraft, setSecondaryOperatorDraft] = useState(secondaryOperatorId ?? "");
  const [savingOperators, setSavingOperators] = useState(false);

  const startEditingOperators = () => {
    setPrimaryOperatorDraft(assignedOperatorId ?? "");
    setSecondaryOperatorDraft(secondaryOperatorId ?? "");
    setEditingOperators(true);
  };

  const cancelEditingOperators = () => {
    setEditingOperators(false);
  };

  const saveOperators = async () => {
    if (!linkageId) return;
    setSavingOperators(true);
    try {
      const res = await fetch(`/api/linkages/${linkageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedOperatorId: primaryOperatorDraft || null,
          secondaryOperatorId: secondaryOperatorDraft || null,
        }),
      });
      if (res.ok) {
        toast.success("Operators updated");
        setEditingOperators(false);
        onVesselUpdated();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to update operators");
      }
    } catch {
      toast.error("Failed to update operators");
    } finally {
      setSavingOperators(false);
    }
  };

  const startEditing = () => {
    setVesselNameDraft(vesselName ?? "");
    setVesselImoDraft(vesselImo ?? "");
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
  };

  const startEditingLinkage = () => {
    setLinkageNumberDraft(linkageCode ?? "");
    setEditingLinkage(true);
  };

  const cancelEditingLinkage = () => {
    setEditingLinkage(false);
  };

  const saveLinkageNumber = async () => {
    if (!linkageId) return;
    const next = linkageNumberDraft.trim();
    if (!next) {
      toast.error("Linkage number cannot be empty");
      return;
    }
    setSavingLinkage(true);
    try {
      const res = await fetch(`/api/linkages/${linkageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkageNumber: next }),
      });
      if (res.ok) {
        toast.success("Linkage number updated");
        setEditingLinkage(false);
        onVesselUpdated();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to update linkage number");
      }
    } catch {
      toast.error("Failed to update linkage number");
    } finally {
      setSavingLinkage(false);
    }
  };

  const saveVessel = async () => {
    if (!linkageId) return;
    setSavingVessel(true);
    try {
      const res = await fetch(`/api/linkages/${linkageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vesselName: vesselNameDraft.trim() || null,
          vesselImo: vesselImoDraft.trim() || null,
        }),
      });
      if (res.ok) {
        toast.success("Vessel updated");
        setEditing(false);
        onVesselUpdated();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to update vessel");
      }
    } catch {
      toast.error("Failed to update vessel");
    } finally {
      setSavingVessel(false);
    }
  };

  return (
    <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-default)] border-b-2 border-b-[var(--color-border-default)]">
      <div className="flex items-center gap-6 px-5 py-3 flex-wrap">
        {/* Linkage code — inline-editable */}
        {editingLinkage && linkageId ? (
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-[var(--color-accent)] flex-shrink-0" />
            <input
              type="text"
              value={linkageNumberDraft}
              onChange={(e) => setLinkageNumberDraft(e.target.value)}
              disabled={savingLinkage}
              placeholder="Linkage number"
              className="w-44 rounded-[var(--radius-sm)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-2 py-1 text-base font-mono font-bold text-[var(--color-text-primary)] tracking-wide"
              autoFocus
            />
            <button
              type="button"
              onClick={saveLinkageNumber}
              disabled={savingLinkage}
              className="p-1 rounded text-[var(--color-success)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-50"
              title="Save linkage number"
            >
              {savingLinkage ? (
                <div className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={cancelEditingLinkage}
              disabled={savingLinkage}
              className="p-1 rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-50"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={canEdit && linkageId ? startEditingLinkage : undefined}
            disabled={!canEdit || !linkageId}
            className={`flex items-center gap-2 ${
              canEdit && linkageId
                ? "cursor-pointer hover:bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] px-2 py-1 -mx-2 -my-1 transition-colors"
                : "cursor-default"
            }`}
            title={canEdit && linkageId ? "Click to edit linkage number" : undefined}
          >
            <Link2 className="h-4 w-4 text-[var(--color-accent)]" />
            <span className="text-lg font-bold font-mono text-[var(--color-text-primary)] tracking-wide">
              {linkageCode}
            </span>
            {canEdit && linkageId && (
              <Pencil className="h-3 w-3 text-[var(--color-text-tertiary)] opacity-60" />
            )}
          </button>
        )}

        <div className="h-5 w-px bg-[var(--color-border-subtle)]" />

        {/* Vessel */}
        {editing && linkageId ? (
          <div className="flex items-center gap-2 flex-1 min-w-[320px] max-w-md">
            <Ship className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] flex-shrink-0" />
            <input
              type="text"
              placeholder="Vessel name"
              value={vesselNameDraft}
              onChange={(e) => setVesselNameDraft(e.target.value)}
              disabled={savingVessel}
              className="flex-1 min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-2 py-1 text-sm text-[var(--color-text-primary)]"
            />
            <input
              type="text"
              placeholder="IMO"
              value={vesselImoDraft}
              onChange={(e) => setVesselImoDraft(e.target.value)}
              disabled={savingVessel}
              className="w-24 rounded-[var(--radius-sm)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-2 py-1 text-xs font-mono text-[var(--color-text-primary)]"
            />
            <button
              type="button"
              onClick={saveVessel}
              disabled={savingVessel}
              className="p-1 rounded text-[var(--color-success)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-50"
              title="Save"
            >
              {savingVessel ? (
                <div className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              disabled={savingVessel}
              className="p-1 rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-50"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={canEdit && linkageId ? startEditing : undefined}
            disabled={!canEdit || !linkageId}
            className={`flex items-center gap-2 ${
              canEdit && linkageId
                ? "cursor-pointer hover:bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] px-2 py-1 -mx-2 -my-1 transition-colors"
                : "cursor-default"
            }`}
            title={canEdit && linkageId ? "Click to edit vessel" : undefined}
          >
            <Ship className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
            <div className="text-left">
              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                {vesselName || "TBN"}
              </span>
              {vesselImo && (
                <span className="text-xs font-mono text-[var(--color-text-tertiary)] ml-1.5">
                  IMO {vesselImo}
                </span>
              )}
            </div>
            {canEdit && linkageId && (
              <Pencil className="h-3 w-3 text-[var(--color-text-tertiary)] opacity-60" />
            )}
          </button>
        )}

        <div className="h-5 w-px bg-[var(--color-border-subtle)]" />

        {/* Product */}
        <div className="flex items-center gap-2">
          <Package className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
          <span className="text-sm text-[var(--color-text-secondary)]">{product}</span>
        </div>

        <div className="h-5 w-px bg-[var(--color-border-subtle)]" />

        {/* Operators — click to edit (linkage-level only) */}
        {editingOperators && linkageId ? (
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
            <select
              value={primaryOperatorDraft}
              onChange={(e) => setPrimaryOperatorDraft(e.target.value)}
              disabled={savingOperators}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            >
              <option value="">— primary —</option>
              {operators.map((op) => (
                <option key={op.id} value={op.id}>{op.name}</option>
              ))}
            </select>
            <select
              value={secondaryOperatorDraft}
              onChange={(e) => setSecondaryOperatorDraft(e.target.value)}
              disabled={savingOperators}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
            >
              <option value="">— secondary —</option>
              {operators.map((op) => (
                <option key={op.id} value={op.id}>{op.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={saveOperators}
              disabled={savingOperators}
              className="p-1 rounded text-[var(--color-success)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-50"
              title="Save operators"
            >
              {savingOperators ? (
                <div className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={cancelEditingOperators}
              disabled={savingOperators}
              className="p-1 rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-50"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={canEdit && linkageId ? startEditingOperators : undefined}
            disabled={!canEdit || !linkageId}
            className={`flex items-center gap-1.5 ${
              canEdit && linkageId
                ? "cursor-pointer hover:bg-[var(--color-surface-3)] rounded-[var(--radius-sm)] px-2 py-1 -mx-2 -my-1 transition-colors"
                : "cursor-default"
            }`}
            title={canEdit && linkageId ? "Click to assign operators (linkage-level)" : undefined}
          >
            <Users className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
            {assignedOperatorId && (
              <span className="h-6 w-6 rounded-full bg-[var(--color-accent)] text-[var(--color-text-inverse)] text-[0.625rem] font-bold flex items-center justify-center">
                {operatorInitials(assignedOperatorId)}
              </span>
            )}
            {secondaryOperatorId && (
              <span className="h-6 w-6 rounded-full bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] text-[0.625rem] font-bold flex items-center justify-center border border-[var(--color-border-subtle)]">
                {operatorInitials(secondaryOperatorId)}
              </span>
            )}
            {!assignedOperatorId && !secondaryOperatorId && (
              <span className="text-xs text-[var(--color-text-tertiary)]">Unassigned</span>
            )}
            {canEdit && linkageId && (
              <Pencil className="h-3 w-3 text-[var(--color-text-tertiary)] opacity-60 ml-0.5" />
            )}
          </button>
        )}

        {/* Pricing - pushed to the right */}
        {(pricingType || pricingFormula) && (
          <>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
              <div className="text-right">
                <div className="flex items-center gap-1.5">
                  {pricingType && (
                    <Badge variant="muted">{pricingType}</Badge>
                  )}
                  {pricingFormula && (
                    <span className="text-xs font-mono text-[var(--color-text-secondary)]">
                      {pricingFormula}
                    </span>
                  )}
                </div>
                {pricingEstimatedDate && (
                  <span className="text-[0.625rem] text-[var(--color-text-tertiary)] font-mono">
                    Est. {pricingEstimatedDate}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// LINKED DEAL CARD (buy or sell side)
// ============================================================

interface LinkedDealCardProps {
  deal: LinkedDeal;
  side: "buy" | "sell";
  isCurrent: boolean;
  isOperator: boolean;
  fetchDeal: () => void;
}

function LinkedDealCard({ deal, side, isCurrent, isOperator, fetchDeal }: LinkedDealCardProps) {
  const ownTerminal = isOwnTerminalDeal(deal.counterparty);
  const borderColor = ownTerminal
    ? "border-l-teal-500/60"
    : side === "buy"
    ? "border-l-blue-500/60"
    : "border-l-amber-500/60";

  const displayName = ownTerminal
    ? deal.counterparty.replace(OWN_TERMINAL_PREFIX, "")
    : deal.counterparty;

  return (
    <Card className={`border-l-[3px] ${borderColor} ${isCurrent ? "ring-1 ring-[var(--color-accent)]/30" : ""}`}>
      {/* Card header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {ownTerminal && (
            <Anchor className="h-3.5 w-3.5 text-teal-500 flex-shrink-0" />
          )}
          <Link
            href={`/deals/${deal.id}`}
            className="text-sm font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent-text)] transition-colors truncate"
          >
            {displayName}
          </Link>
          {ownTerminal ? (
            <span className="text-[0.5625rem] font-semibold px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 uppercase tracking-wider flex-shrink-0">
              Own Terminal
            </span>
          ) : (
            <Badge variant={deal.direction === "buy" ? "info" : "accent"}>
              {deal.direction}
            </Badge>
          )}
          <Badge variant="muted">{deal.incoterm}</Badge>
          {isCurrent && (
            <span className="text-[0.5625rem] font-mono px-1.5 py-0.5 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent-text)] uppercase tracking-wider">
              Current
            </span>
          )}
        </div>
        <Link href={`/deals/${deal.id}/edit`}>
          <Button variant="ghost" size="sm" className="!p-1">
            <Pencil className="h-3 w-3" />
          </Button>
        </Link>
      </div>

      {/* Key fields */}
      <div className="px-4 pb-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Field
            label="Quantity"
            value={`${Number(deal.quantityMt).toLocaleString()} MT`}
            mono
          />
          <Field
            label="Nominated"
            value={deal.nominatedQty ? `${Number(deal.nominatedQty).toLocaleString()} MT` : null}
            mono
          />
          <Field label="Loadport" value={deal.loadport} />
          <Field label="Discharge" value={deal.dischargePort} />
          <Field
            label="Laycan"
            value={`${deal.laycanStart} — ${deal.laycanEnd}`}
            mono
          />
          <Field label="Status" value={deal.status.charAt(0).toUpperCase() + deal.status.slice(1)} />
        </dl>
        {deal.direction === "buy" && (
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--color-border-subtle)]">
            <span className="text-xs text-[var(--color-text-tertiary)]">Loaded Qty:</span>
            <input
              type="number"
              step="0.001"
              placeholder={deal.quantityMt}
              defaultValue={deal.loadedQuantityMt ?? ""}
              className="w-32 text-xs h-6 px-2 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)]"
              onBlur={(e) => {
                if (e.target.value) {
                  fetch(`/api/deals/${deal.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ loadedQuantityMt: parseFloat(e.target.value), version: deal.version }),
                  }).then(() => fetchDeal());
                }
              }}
            />
            <span className="text-[0.6rem] text-[var(--color-text-tertiary)]">MT</span>
          </div>
        )}
      </div>

      {/* Workflow for this deal */}
      <div className="border-t border-[var(--color-border-subtle)] px-4 py-3">
        <WorkflowSection
          dealId={deal.id}
          dealStatus={deal.status}
          isOperator={isOperator}
          loadport={deal.loadport}
          dischargePort={deal.dischargePort ?? null}
        />
      </div>
    </Card>
  );
}

// ============================================================
// OWN TERMINAL PREFIX (used to detect discharge-to-own-terminal deals)
// ============================================================

const OWN_TERMINAL_PREFIX = "Own Terminal — ";

function isOwnTerminalDeal(counterparty: string): boolean {
  return counterparty.startsWith(OWN_TERMINAL_PREFIX);
}

// ============================================================
// ADD DEAL MENU (4 options per side: Terminal, Existing, Parse, New)
// ============================================================

interface Party {
  id: string;
  name: string;
  port: string | null;
  type: string;
  isFixed: boolean;
}

interface ExistingDealSummary {
  id: string;
  linkageCode: string | null;
  linkageId: string | null;
  counterparty: string;
  direction: string;
  product: string;
  quantityMt: string;
  incoterm: string;
  loadport: string;
  dischargePort: string | null;
  laycanStart: string;
  laycanEnd: string;
  version: number;
}

interface AddDealMenuProps {
  side: "buy" | "sell";
  linkageId: string;
  linkageCode: string;
  referenceDeal: LinkedDeal | null;
  onCreated: () => void;
}

function AddDealMenu({ side, linkageId, linkageCode, referenceDeal, onCreated }: AddDealMenuProps) {
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);
  const [subView, setSubView] = useState<"none" | "terminal" | "existing">("none");

  // Terminal picker state
  const [terminals, setTerminals] = useState<Party[]>([]);
  const [loadingTerminals, setLoadingTerminals] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);

  // Existing deals picker state
  const [existingDeals, setExistingDeals] = useState<ExistingDealSummary[]>([]);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [existingQuery, setExistingQuery] = useState("");
  const [movingDealId, setMovingDealId] = useState<string | null>(null);

  const isBuy = side === "buy";
  const sideDirection: "buy" | "sell" = side;
  const sideLabel = isBuy ? "purchase / loading" : "sale / discharge";
  const existingBorderClass = isBuy
    ? "border-blue-400/50 bg-blue-50/20 dark:bg-blue-950/10"
    : "border-amber-400/50 bg-amber-50/20 dark:bg-amber-950/10";
  const existingIconClass = isBuy
    ? "text-blue-600 dark:text-blue-400"
    : "text-amber-600 dark:text-amber-400";
  const terminalLabel = isBuy ? "Load from own terminal" : "Discharge to own terminal";
  const terminalDescription = "Own terminal (Amsterdam, Klaipeda, Antwerp)";

  const closeAll = () => {
    setShowMenu(false);
    setSubView("none");
  };

  const fetchTerminals = async () => {
    setLoadingTerminals(true);
    try {
      const res = await fetch("/api/parties?type=terminal");
      const data = await res.json();
      const all: Party[] = Array.isArray(data) ? data : [...(data.matched ?? []), ...(data.rest ?? [])];
      setTerminals(all.filter((t) => t.isFixed));
    } catch {
      setTerminals([]);
    }
    setLoadingTerminals(false);
  };

  const handleTerminalOperation = async (terminal: Party) => {
    // Hard guard: a terminal-op MUST be attached to the current linkage. If
    // linkageId is somehow missing (stale closure, prop drift, etc.) we refuse
    // to create the deal — silently auto-creating a TEMP linkage was the
    // round 5/6 data-loss bug.
    if (!linkageId) {
      toast.error("Cannot add terminal operation: linkage is not loaded yet. Please refresh.");
      return;
    }
    setCreating(terminal.id);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const counterparty = `${OWN_TERMINAL_PREFIX}${terminal.name}`;
      const dealPayload = isBuy
        ? {
            counterparty,
            direction: "buy" as const,
            // CRITICAL: dealType must be set so the Excel view groups this row
            // under INTERNAL / TERMINAL OPERATIONS instead of PURCHASE.
            dealType: "terminal_operation" as const,
            product: referenceDeal?.product ?? "Gasoline",
            quantityMt: 1,
            incoterm: referenceDeal?.incoterm ?? "FOB",
            loadport: terminal.port ?? terminal.name,
            dischargePort: referenceDeal?.dischargePort ?? null,
            laycanStart: referenceDeal?.laycanStart ?? today,
            laycanEnd: referenceDeal?.laycanEnd ?? today,
            linkageId,
            linkageCode,
            vesselName: referenceDeal?.vesselName ?? null,
            vesselImo: referenceDeal?.vesselImo ?? null,
            specialInstructions: `Load from own terminal: ${terminal.name}`,
          }
        : {
            counterparty,
            direction: "sell" as const,
            dealType: "terminal_operation" as const,
            product: referenceDeal?.product ?? "Gasoline",
            quantityMt: 1,
            incoterm: referenceDeal?.incoterm ?? "FOB",
            loadport: referenceDeal?.loadport ?? "",
            dischargePort: terminal.port ?? terminal.name,
            laycanStart: referenceDeal?.laycanStart ?? today,
            laycanEnd: referenceDeal?.laycanEnd ?? today,
            linkageId,
            linkageCode,
            vesselName: referenceDeal?.vesselName ?? null,
            vesselImo: referenceDeal?.vesselImo ?? null,
            specialInstructions: `Discharge to own terminal: ${terminal.name}`,
          };

      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dealPayload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to create terminal operation");
        setCreating(null);
        return;
      }

      const newDeal = await res.json();
      await fetch(`/api/deals/${newDeal.id}/workflow`, { method: "POST" });

      toast.success(
        isBuy
          ? `Load from ${terminal.name} created`
          : `Discharge to ${terminal.name} created`
      );
      closeAll();
      onCreated();
    } catch {
      toast.error("Failed to create terminal operation");
    }
    setCreating(null);
  };

  const fetchExistingDeals = async () => {
    setLoadingExisting(true);
    try {
      const res = await fetch(`/api/deals?direction=${sideDirection}&perPage=50`);
      const data = await res.json();
      const items: ExistingDealSummary[] = (data.items ?? []) as ExistingDealSummary[];
      // Filter out deals already in this linkage
      setExistingDeals(items.filter((d) => d.linkageId !== linkageId));
    } catch {
      setExistingDeals([]);
    }
    setLoadingExisting(false);
  };

  const handleMoveDeal = async (existing: ExistingDealSummary) => {
    setMovingDealId(existing.id);
    try {
      const res = await fetch(`/api/deals/${existing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkageId,
          linkageCode,
          version: existing.version,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Failed to move deal into linkage");
        setMovingDealId(null);
        return;
      }
      toast.success(`${existing.counterparty} added to linkage`);
      closeAll();
      onCreated();
    } catch {
      toast.error("Failed to move deal into linkage");
    }
    setMovingDealId(null);
  };

  const goParse = () => {
    closeAll();
    router.push(
      `/deals/parse?linkageId=${encodeURIComponent(linkageId)}&linkageCode=${encodeURIComponent(linkageCode)}&direction=${sideDirection}`
    );
  };

  const goNew = () => {
    closeAll();
    router.push(
      `/deals/new?linkageId=${encodeURIComponent(linkageId)}&linkageCode=${encodeURIComponent(linkageCode)}&direction=${sideDirection}`
    );
  };

  const filteredExisting = existingDeals.filter((d) => {
    if (!existingQuery.trim()) return true;
    const q = existingQuery.toLowerCase();
    return (
      d.counterparty.toLowerCase().includes(q) ||
      d.product.toLowerCase().includes(q) ||
      (d.linkageCode ?? "").toLowerCase().includes(q) ||
      d.loadport.toLowerCase().includes(q) ||
      (d.dischargePort ?? "").toLowerCase().includes(q)
    );
  });

  // Terminal picker sub-view
  if (subView === "terminal") {
    return (
      <div className="rounded-[var(--radius-md)] border-2 border-dashed border-teal-400/50 bg-teal-50/30 dark:bg-teal-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Anchor className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              {terminalLabel}
            </span>
          </div>
          <button
            onClick={closeAll}
            className="p-1 rounded hover:bg-[var(--color-surface-3)] transition-colors"
          >
            <X className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
          </button>
        </div>

        {loadingTerminals ? (
          <div className="flex items-center justify-center py-4">
            <div className="h-4 w-4 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
          </div>
        ) : terminals.length === 0 ? (
          <p className="text-sm text-[var(--color-text-tertiary)] text-center py-3">
            No own terminals found. Add terminals with &quot;Fixed&quot; flag in Party Management.
          </p>
        ) : (
          <div className="grid gap-2">
            {terminals.map((t) => (
              <button
                key={t.id}
                onClick={() => handleTerminalOperation(t)}
                disabled={creating !== null}
                className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] hover:bg-teal-50 dark:hover:bg-teal-950/30 hover:border-teal-400/50 transition-all text-left disabled:opacity-50"
              >
                <div className="h-8 w-8 rounded-full bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center flex-shrink-0">
                  <Anchor className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {t.name}
                  </div>
                  {t.port && (
                    <div className="text-xs text-[var(--color-text-tertiary)]">{t.port}</div>
                  )}
                </div>
                {creating === t.id && (
                  <div className="h-4 w-4 rounded-full border-2 border-teal-500 border-t-transparent animate-spin flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Existing deals picker sub-view
  if (subView === "existing") {
    return (
      <div
        className={`rounded-[var(--radius-md)] border-2 border-dashed ${existingBorderClass} p-4 space-y-3`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className={`h-4 w-4 ${existingIconClass}`} />
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              Add existing {sideDirection} deal
            </span>
          </div>
          <button
            onClick={closeAll}
            className="p-1 rounded hover:bg-[var(--color-surface-3)] transition-colors"
          >
            <X className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
          </button>
        </div>

        <input
          type="text"
          value={existingQuery}
          onChange={(e) => setExistingQuery(e.target.value)}
          placeholder="Search counterparty, product, linkage, port..."
          className="w-full h-8 px-2 text-sm rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
        />

        {loadingExisting ? (
          <div className="flex items-center justify-center py-4">
            <div className="h-4 w-4 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
          </div>
        ) : filteredExisting.length === 0 ? (
          <p className="text-sm text-[var(--color-text-tertiary)] text-center py-3">
            {existingDeals.length === 0
              ? `No other ${sideDirection} deals found.`
              : "No deals match your search."}
          </p>
        ) : (
          <div className="grid gap-1.5 max-h-64 overflow-y-auto">
            {filteredExisting.map((d) => (
              <button
                key={d.id}
                onClick={() => handleMoveDeal(d)}
                disabled={movingDealId !== null}
                className="flex items-center gap-3 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-3)] transition-all text-left disabled:opacity-50"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {d.counterparty}
                    </span>
                    {d.linkageCode && (
                      <span className="text-[0.625rem] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] flex-shrink-0">
                        {d.linkageCode}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-text-tertiary)] truncate">
                    {Number(d.quantityMt).toLocaleString()} MT {d.product} — {d.incoterm} —{" "}
                    {d.loadport}
                    {d.dischargePort ? ` → ${d.dischargePort}` : ""}
                  </div>
                </div>
                {movingDealId === d.id && (
                  <div className="h-4 w-4 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Collapsed trigger card
  if (!showMenu) {
    return (
      <button
        onClick={() => setShowMenu(true)}
        className="w-full rounded-[var(--radius-md)] border-2 border-dashed border-[var(--color-border-subtle)] hover:border-[var(--color-accent)] bg-transparent hover:bg-[var(--color-accent-muted)] transition-all py-8 flex flex-col items-center justify-center gap-2 group cursor-pointer"
      >
        <div className="h-9 w-9 rounded-full bg-[var(--color-surface-3)] group-hover:bg-[var(--color-accent)] flex items-center justify-center transition-colors">
          <Plus className="h-4 w-4 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-inverse)] transition-colors" />
        </div>
        <span className="text-sm font-medium text-[var(--color-text-tertiary)] group-hover:text-[var(--color-accent-text)] transition-colors">
          Add {sideLabel}
        </span>
      </button>
    );
  }

  // Expanded menu with 4 options
  return (
    <div className="rounded-[var(--radius-md)] border-2 border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-hidden">
      {/* Option 1: Terminal operation */}
      <button
        onClick={() => {
          setSubView("terminal");
          fetchTerminals();
        }}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-teal-50 dark:hover:bg-teal-950/20 transition-colors text-left border-b border-[var(--color-border-subtle)]"
      >
        <div className="h-8 w-8 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center flex-shrink-0">
          <Anchor className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
        </div>
        <div>
          <div className="text-sm font-medium text-[var(--color-text-primary)]">
            {terminalLabel}
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)]">{terminalDescription}</div>
        </div>
      </button>

      {/* Option 2: Add existing deal */}
      <button
        onClick={() => {
          setSubView("existing");
          fetchExistingDeals();
        }}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-[var(--color-accent-muted)] transition-colors text-left border-b border-[var(--color-border-subtle)]"
      >
        <div
          className={`h-8 w-8 rounded-full ${
            isBuy
              ? "bg-blue-100 dark:bg-blue-900/30"
              : "bg-amber-100 dark:bg-amber-900/30"
          } flex items-center justify-center flex-shrink-0`}
        >
          <Link2
            className={`h-3.5 w-3.5 ${
              isBuy
                ? "text-blue-600 dark:text-blue-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
          />
        </div>
        <div>
          <div className="text-sm font-medium text-[var(--color-text-primary)]">
            Add existing deal
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)]">
            Pick a {sideDirection} deal from another linkage
          </div>
        </div>
      </button>

      {/* Option 3: Parse email */}
      <button
        onClick={goParse}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-purple-50 dark:hover:bg-purple-950/20 transition-colors text-left border-b border-[var(--color-border-subtle)]"
      >
        <div className="h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
          <Mail className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <div className="text-sm font-medium text-[var(--color-text-primary)]">Parse email</div>
          <div className="text-xs text-[var(--color-text-tertiary)]">
            Drop a trader recap — AI parses into a {sideDirection} deal
          </div>
        </div>
      </button>

      {/* Option 4: New deal from scratch */}
      <button
        onClick={goNew}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-[var(--color-accent-muted)] transition-colors text-left"
      >
        <div className="h-8 w-8 rounded-full bg-[var(--color-surface-3)] flex items-center justify-center flex-shrink-0">
          <Plus className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
        </div>
        <div>
          <div className="text-sm font-medium text-[var(--color-text-primary)]">
            New deal from scratch
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)]">
            Open the {sideDirection} deal form, pre-filled for this linkage
          </div>
        </div>
      </button>

      <button
        onClick={closeAll}
        className="w-full py-2 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors border-t border-[var(--color-border-subtle)]"
      >
        Cancel
      </button>
    </div>
  );
}

// ============================================================
// LINKAGE NOTES — inline-editable notes below the voyage bar
// ============================================================

function LinkageNotesSection({ linkageId, notes, canEdit, onSaved }: {
  linkageId: string;
  notes: string | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(!!notes);
  const [draft, setDraft] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (draft === (notes ?? "")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/linkages/${linkageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: draft.trim() || null }),
      });
      if (res.ok) {
        onSaved();
      } else {
        toast.error("Failed to save notes");
      }
    } catch {
      toast.error("Failed to save notes");
    } finally {
      setSaving(false);
    }
  };

  if (!expanded && !notes) {
    return canEdit ? (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer"
      >
        <FileText className="h-3 w-3" />
        Add notes
      </button>
    ) : null;
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-2.5">
      <div
        className="flex items-center gap-1.5 mb-1 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <FileText className="h-3 w-3 text-[var(--color-text-tertiary)]" />
        <span className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">Notes</span>
        {!expanded && notes && (
          <span className="text-xs text-[var(--color-text-secondary)] ml-1 truncate max-w-md">{notes.split("\n")[0]}</span>
        )}
      </div>
      {expanded && (
        canEdit ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            disabled={saving}
            placeholder="Add notes about this voyage..."
            rows={3}
            className="w-full bg-transparent text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] outline-none resize-y min-h-[60px] disabled:opacity-60"
          />
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">{notes || "No notes"}</p>
        )
      )}
    </div>
  );
}

// ============================================================
// LINKAGE STATUS TOGGLE — active ↔ completed
// ============================================================

function LinkageStatusToggle({ linkageId, status, canEdit, onToggled }: {
  linkageId: string;
  status: string;
  canEdit: boolean;
  onToggled: () => void;
}) {
  const [toggling, setToggling] = useState(false);

  const toggle = async () => {
    if (!canEdit || toggling) return;
    const newStatus = status === "active" ? "completed" : "active";
    setToggling(true);
    try {
      const res = await fetch(`/api/linkages/${linkageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast.success(`Linkage marked ${newStatus}`);
        onToggled();
      } else {
        toast.error("Failed to update status");
      }
    } catch {
      toast.error("Failed to update status");
    } finally {
      setToggling(false);
    }
  };

  return (
    <button
      type="button"
      onClick={canEdit ? toggle : undefined}
      disabled={!canEdit || toggling}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.625rem] font-medium transition-colors ${
        status === "completed"
          ? "bg-green-900/30 text-green-400 border border-green-700/40"
          : "bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]"
      } ${canEdit ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
      title={canEdit ? `Click to mark ${status === "active" ? "completed" : "active"}` : undefined}
    >
      {toggling ? (
        <div className="h-2 w-2 rounded-full border border-current border-t-transparent animate-spin" />
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${status === "completed" ? "bg-green-400" : "bg-[var(--color-text-tertiary)]"}`} />
      )}
      {status === "completed" ? "Completed" : "Active"}
    </button>
  );
}

// ============================================================
// LINKAGE VIEW (two-column buy/sell layout)
// ============================================================

interface LinkageViewProps {
  deal: DealDetail;
  linkedDeals: LinkedDeal[];
  linkage: LinkageDetail | null;
  isOperator: boolean;
  fetchDeal: () => void;
}

function LinkageView({ deal, linkedDeals, linkage, isOperator, fetchDeal }: LinkageViewProps) {
  const router = useRouter();
  const buyDeals = linkedDeals.filter((d) => d.direction === "buy");
  const sellDeals = linkedDeals.filter((d) => d.direction === "sell");

  // Merge dialog state
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeLinkages, setMergeLinkages] = useState<LinkageSummary[]>([]);
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeKeepNumber, setMergeKeepNumber] = useState<"target" | "source">("target");
  const [mergeLoading, setMergeLoading] = useState(false);

  // Split dialog state
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitDealIds, setSplitDealIds] = useState<Set<string>>(new Set());
  const [splitLoading, setSplitLoading] = useState(false);

  const openMergeDialog = async () => {
    setMergeOpen(true);
    setMergeSourceId("");
    setMergeKeepNumber("target");
    try {
      const res = await fetch("/api/linkages?status=active");
      const data: LinkageSummary[] = await res.json();
      // Exclude the current linkage
      setMergeLinkages(data.filter((l) => l.id !== deal.linkageId));
    } catch {
      setMergeLinkages([]);
    }
  };

  const handleMerge = async () => {
    if (!mergeSourceId || !deal.linkageId) return;
    setMergeLoading(true);
    try {
      const res = await fetch(`/api/linkages/${deal.linkageId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLinkageId: mergeSourceId, keepNumber: mergeKeepNumber }),
      });
      if (res.ok) {
        toast.success("Linkages merged successfully");
        setMergeOpen(false);
        fetchDeal();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to merge linkages");
      }
    } catch {
      toast.error("Failed to merge linkages");
    } finally {
      setMergeLoading(false);
    }
  };

  const openSplitDialog = () => {
    setSplitOpen(true);
    setSplitDealIds(new Set());
  };

  const toggleSplitDeal = (dealId: string) => {
    setSplitDealIds((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) {
        next.delete(dealId);
      } else {
        next.add(dealId);
      }
      return next;
    });
  };

  const handleSplit = async () => {
    if (splitDealIds.size === 0 || !deal.linkageId) return;
    setSplitLoading(true);
    try {
      const res = await fetch(`/api/linkages/${deal.linkageId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealIds: Array.from(splitDealIds) }),
      });
      if (res.ok) {
        toast.success("Deals split into a new linkage");
        setSplitOpen(false);
        fetchDeal();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to split deals");
      }
    } catch {
      toast.error("Failed to split deals");
    } finally {
      setSplitLoading(false);
    }
  };

  // Delete dialog state
  const [deleteDealOpen, setDeleteDealOpen] = useState(false);
  const [deleteDealLoading, setDeleteDealLoading] = useState(false);
  const [deleteLinkageOpen, setDeleteLinkageOpen] = useState(false);
  const [deleteLinkageLoading, setDeleteLinkageLoading] = useState(false);

  const handleDeleteDeal = async () => {
    setDeleteDealLoading(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Deal deleted");
        router.push("/deals");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to delete deal");
        setDeleteDealLoading(false);
        setDeleteDealOpen(false);
      }
    } catch {
      toast.error("Failed to delete deal");
      setDeleteDealLoading(false);
      setDeleteDealOpen(false);
    }
  };

  const handleDeleteLinkage = async () => {
    if (!deal.linkageId) return;
    setDeleteLinkageLoading(true);
    try {
      const res = await fetch(`/api/linkages/${deal.linkageId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Linkage deleted");
        router.push("/deals");
      } else {
        const err = await res.json().catch(() => ({}));
        if (err.error === "linkage_has_deals") {
          toast.error(err.message || "Remove all deals from this linkage first");
        } else {
          toast.error(err.error || "Failed to delete linkage");
        }
        setDeleteLinkageLoading(false);
        setDeleteLinkageOpen(false);
      }
    } catch {
      toast.error("Failed to delete linkage");
      setDeleteLinkageLoading(false);
      setDeleteLinkageOpen(false);
    }
  };

  // Gather shared voyage info from whichever deal has it
  const voyageSource = linkedDeals.find((d) => d.vesselName) ?? linkedDeals[0];
  const pricingSource = linkedDeals.find((d) => d.pricingFormula || d.pricingType) ?? linkedDeals[0];

  return (
    <div className="space-y-6">
      {/* Back + edit header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={deal.linkageId ? `/linkages/${deal.linkageId}` : "/deals"}
            className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
              Linked Voyage
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
              {buyDeals.length} purchase{buyDeals.length !== 1 ? "s" : ""} + {sellDeals.length} sale{sellDeals.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isOperator && deal.linkageId && (
            <>
              <Button variant="ghost" size="sm" onClick={openMergeDialog}>
                <Merge className="h-3.5 w-3.5" />
                Merge
              </Button>
              <Button variant="ghost" size="sm" onClick={openSplitDialog} disabled={linkedDeals.length < 2}>
                <Scissors className="h-3.5 w-3.5" />
                Split
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteLinkageOpen(true)}
                className="text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Linkage
              </Button>
            </>
          )}
          {isOperator && (
            <Link href={`/deals/${deal.id}/edit`}>
              <Button variant="secondary" size="md">
                <Pencil className="h-3.5 w-3.5" />
                Edit Current
              </Button>
            </Link>
          )}
          {isOperator && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteDealOpen(true)}
              className="text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete Deal
            </Button>
          )}
          <DealExportDropdown dealId={deal.id} />
        </div>
      </div>

      {/* Merge Dialog */}
      <Dialog
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="Merge Linkages"
        description="Merge another linkage into this one. All deals from the selected linkage will be moved here."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
              Select linkage to merge into this one
            </label>
            <select
              value={mergeSourceId}
              onChange={(e) => setMergeSourceId(e.target.value)}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
            >
              <option value="">Select a linkage...</option>
              {mergeLinkages.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.linkageNumber ?? l.tempName} ({l.dealCount} deal{l.dealCount !== 1 ? "s" : ""})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
              Which linkage number to keep?
            </label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer">
                <input
                  type="radio"
                  name="keepNumber"
                  checked={mergeKeepNumber === "target"}
                  onChange={() => setMergeKeepNumber("target")}
                  className="accent-[var(--color-accent)]"
                />
                This linkage ({deal.linkageCode ?? "—"})
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] cursor-pointer">
                <input
                  type="radio"
                  name="keepNumber"
                  checked={mergeKeepNumber === "source"}
                  onChange={() => setMergeKeepNumber("source")}
                  className="accent-[var(--color-accent)]"
                />
                Source linkage
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setMergeOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleMerge}
              disabled={!mergeSourceId}
              loading={mergeLoading}
            >
              Merge
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Split Dialog */}
      <Dialog
        open={splitOpen}
        onClose={() => setSplitOpen(false)}
        title="Split Linkage"
        description="Select deals to split into a new linkage. At least one deal must remain in the current linkage."
      >
        <div className="space-y-4">
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {linkedDeals.map((d) => (
              <label
                key={d.id}
                className="flex items-center gap-3 p-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)] cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={splitDealIds.has(d.id)}
                  onChange={() => toggleSplitDeal(d.id)}
                  disabled={splitDealIds.size === linkedDeals.length - 1 && !splitDealIds.has(d.id)}
                  className="accent-[var(--color-accent)]"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium uppercase ${d.direction === "buy" ? "text-blue-400" : "text-amber-400"}`}>
                      {d.direction}
                    </span>
                    <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {d.counterparty}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    {d.quantityMt} MT {d.product} — {d.incoterm}
                  </span>
                </div>
              </label>
            ))}
          </div>
          {splitDealIds.size === linkedDeals.length - 1 && (
            <p className="text-xs text-[var(--color-text-tertiary)]">
              At least one deal must remain in the current linkage.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setSplitOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSplit}
              disabled={splitDealIds.size === 0}
              loading={splitLoading}
            >
              Split {splitDealIds.size > 0 ? `(${splitDealIds.size} deal${splitDealIds.size !== 1 ? "s" : ""})` : ""}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete Deal Confirmation */}
      <Dialog
        open={deleteDealOpen}
        onClose={() => !deleteDealLoading && setDeleteDealOpen(false)}
        title="Delete this deal?"
        description="This will permanently remove the deal and all of its workflow steps, email drafts, and change history. This cannot be undone."
      >
        <div className="space-y-4">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
            <div className="font-medium text-[var(--color-text-primary)] mb-1">
              {deal.counterparty} — {deal.direction.toUpperCase()} {deal.product}
            </div>
            <div className="text-xs font-mono text-[var(--color-text-tertiary)]">
              {Number(deal.quantityMt).toLocaleString()} MT · {deal.incoterm} · {deal.loadport}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setDeleteDealOpen(false)} disabled={deleteDealLoading}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteDeal}
              loading={deleteDealLoading}
            >
              Delete Deal
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete Linkage Confirmation */}
      <Dialog
        open={deleteLinkageOpen}
        onClose={() => !deleteLinkageLoading && setDeleteLinkageOpen(false)}
        title="Delete this linkage?"
        description="Linkages can only be deleted when empty. If this linkage still has deals, you'll need to remove them first."
      >
        <div className="space-y-4">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
            <div className="font-mono font-medium text-[var(--color-text-primary)] mb-1">
              {deal.linkageCode}
            </div>
            <div className="text-xs text-[var(--color-text-tertiary)]">
              {linkedDeals.length} deal{linkedDeals.length === 1 ? "" : "s"} currently attached
            </div>
          </div>
          {linkedDeals.length > 0 && (
            <p className="text-xs text-[var(--color-warning)]">
              This linkage still contains {linkedDeals.length} deal{linkedDeals.length === 1 ? "" : "s"}.
              The delete will fail — remove all deals first.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setDeleteLinkageOpen(false)} disabled={deleteLinkageLoading}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteLinkage}
              loading={deleteLinkageLoading}
              disabled={linkedDeals.length > 0}
            >
              Delete Linkage
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Voyage Info Bar */}
      <VoyageInfoBar
        linkageCode={deal.linkageCode!}
        linkageId={deal.linkageId ?? null}
        vesselName={linkage?.vesselName ?? voyageSource?.vesselName ?? null}
        vesselImo={linkage?.vesselImo ?? voyageSource?.vesselImo ?? null}
        product={voyageSource?.product ?? deal.product}
        assignedOperatorId={linkage?.assignedOperatorId ?? voyageSource?.assignedOperatorId ?? null}
        secondaryOperatorId={linkage?.secondaryOperatorId ?? voyageSource?.secondaryOperatorId ?? null}
        pricingType={pricingSource?.pricingType ?? null}
        pricingFormula={pricingSource?.pricingFormula ?? null}
        pricingEstimatedDate={pricingSource?.pricingEstimatedDate ?? null}
        canEdit={isOperator}
        onVesselUpdated={fetchDeal}
      />

      {/* Linkage notes — inline-editable */}
      {deal.linkageId && linkage && (
        <LinkageNotesSection linkageId={deal.linkageId} notes={linkage.notes} canEdit={isOperator} onSaved={fetchDeal} />
      )}

      {/* Qty summary bar */}
      <div className="flex items-center gap-4 px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] text-xs font-mono">
        {(() => {
          const buyTotal = buyDeals.reduce((s, d) => s + parseFloat(d.quantityMt || "0"), 0);
          const sellTotal = sellDeals.reduce((s, d) => s + parseFloat(d.quantityMt || "0"), 0);
          const balance = buyTotal - sellTotal;
          return (
            <>
              <span className="text-[var(--color-info)]">Buy: {buyTotal.toLocaleString()} MT</span>
              <span className="text-[var(--color-border-subtle)]">|</span>
              <span className="text-[var(--color-accent-text)]">Sell: {sellTotal.toLocaleString()} MT</span>
              <span className="text-[var(--color-border-subtle)]">|</span>
              <span className={balance >= 0 ? "text-[var(--color-text-secondary)]" : "text-[var(--color-danger)]"}>
                Balance: ~{Math.abs(balance).toLocaleString()} MT {balance < 0 ? "(oversold)" : ""}
              </span>
              {linkage && (
                <>
                  <span className="flex-1" />
                  <LinkageStatusToggle linkageId={deal.linkageId!} status={linkage.status} canEdit={isOperator} onToggled={fetchDeal} />
                </>
              )}
            </>
          );
        })()}
      </div>

      {/* Documents */}
      <DocumentsSection dealId={deal.id} />

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Buy side */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-500/60" />
            Purchase / Load
            <span className="text-xs font-normal text-[var(--color-text-tertiary)] ml-1">
              ({buyDeals.length} deal{buyDeals.length !== 1 ? "s" : ""})
            </span>
          </h2>
          {buyDeals.length === 0 ? (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] py-6 text-center">
              <p className="text-sm text-[var(--color-text-tertiary)]">No purchase deals linked</p>
            </div>
          ) : (
            buyDeals.map((d) => (
              <LinkedDealCard
                key={d.id}
                deal={d}
                side="buy"
                isCurrent={d.id === deal.id}
                isOperator={isOperator}
                fetchDeal={fetchDeal}
              />
            ))
          )}
          {/* Always show "Add Purchase / Loading" menu */}
          {isOperator && deal.linkageId && (
            <AddDealMenu
              side="buy"
              linkageId={deal.linkageId}
              linkageCode={deal.linkageCode ?? ""}
              referenceDeal={buyDeals[0] ?? sellDeals[0] ?? null}
              onCreated={fetchDeal}
            />
          )}
        </div>

        {/* Right: Sell side */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500/60" />
            Sale / Discharge
            <span className="text-xs font-normal text-[var(--color-text-tertiary)] ml-1">
              ({sellDeals.length} deal{sellDeals.length !== 1 ? "s" : ""})
            </span>
          </h2>
          {sellDeals.length === 0 ? (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] py-6 text-center">
              <p className="text-sm text-[var(--color-text-tertiary)]">No sale deals linked</p>
            </div>
          ) : (
            sellDeals.map((d) => (
              <LinkedDealCard
                key={d.id}
                deal={d}
                side="sell"
                isCurrent={d.id === deal.id}
                isOperator={isOperator}
                fetchDeal={fetchDeal}
              />
            ))
          )}
          {/* Always show "Add Sale / Discharge" menu */}
          {isOperator && deal.linkageId && (
            <AddDealMenu
              side="sell"
              linkageId={deal.linkageId}
              linkageCode={deal.linkageCode ?? ""}
              referenceDeal={buyDeals[0] ?? sellDeals[0] ?? null}
              onCreated={fetchDeal}
            />
          )}
        </div>
      </div>

      {/* Change History + Audit (for current deal only, below the grid) */}
      <DealFooterSections deal={deal} />
    </div>
  );
}

// ============================================================
// SINGLE DEAL VIEW (original layout, no linkage)
// ============================================================

interface SingleDealViewProps {
  deal: DealDetail;
  canEdit: boolean;
  isOperator: boolean;
  fetchDeal: () => void;
}

function SingleDealView({ deal, canEdit, isOperator, fetchDeal }: SingleDealViewProps) {
  const router = useRouter();
  const [deleteDealOpen, setDeleteDealOpen] = useState(false);
  const [deleteDealLoading, setDeleteDealLoading] = useState(false);

  const handleDeleteDeal = async () => {
    setDeleteDealLoading(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Deal deleted");
        router.push("/deals");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to delete deal");
        setDeleteDealLoading(false);
        setDeleteDealOpen(false);
      }
    } catch {
      toast.error("Failed to delete deal");
      setDeleteDealLoading(false);
      setDeleteDealOpen(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={deal.linkageId ? `/linkages/${deal.linkageId}` : "/deals"}
              className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
                  {deal.counterparty}
                </h1>
                <Badge variant={deal.direction === "buy" ? "info" : "accent"}>
                  {deal.direction}
                </Badge>
              </div>
              <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
                {deal.product} — {deal.incoterm} — {Number(deal.quantityMt).toLocaleString()} MT
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <Link href={`/deals/${deal.id}/edit`}>
                <Button variant="secondary" size="md">
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </Link>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteDealOpen(true)}
                className="text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            )}
            <DealExportDropdown dealId={deal.id} />
          </div>
        </div>

        {/* Status progression moved to linkage level */}
      </div>

      {/* Deal details */}
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Core Details</CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Counterparty" value={deal.counterparty} />
            <Field label="External Ref" value={deal.externalRef} mono />
            <Field label="Direction" value={deal.direction.toUpperCase()} />
            <Field label="Incoterm" value={deal.incoterm} />
            <Field label="Product" value={deal.product} />
            <Field label="Quantity" value={`${Number(deal.quantityMt).toLocaleString()} MT`} mono />
            <Field label="Contracted Qty" value={deal.contractedQty} />
            <Field label="Nominated Qty" value={deal.nominatedQty ? `${Number(deal.nominatedQty).toLocaleString()} MT` : null} mono />
            <Field label="Linkage Code" value={deal.linkageCode} mono />
            <Field label="Secondary Operator" value={deal.secondaryOperatorId ? deal.secondaryOperatorId : null} />
          </dl>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Logistics</CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Loadport" value={deal.loadport} />
            <Field label="Discharge Port" value={deal.dischargePort} />
            <Field label="Laycan Start" value={deal.laycanStart} mono />
            <Field label="Laycan End" value={deal.laycanEnd} mono />
          </dl>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vessel</CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Vessel Name" value={deal.vesselName} />
            <Field label="Vessel IMO" value={deal.vesselImo} mono />
            <div>
              <dt className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">
                Vessel Cleared
              </dt>
              <dd className="mt-0.5">
                <Badge variant={deal.vesselCleared ? "success" : "muted"}>
                  {deal.vesselCleared ? "Yes" : "No"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">
                Doc Instructions
              </dt>
              <dd className="mt-0.5">
                <Badge variant={deal.docInstructionsReceived ? "success" : "muted"}>
                  {deal.docInstructionsReceived ? "Received" : "Pending"}
                </Badge>
              </dd>
            </div>
          </dl>
        </Card>

        <div className="col-span-2">
          <DocumentsSection dealId={deal.id} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Additional</CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Pricing Formula" value={deal.pricingFormula} />
            <Field label="Pricing Type" value={deal.pricingType} />
            <Field label="Pricing Est. Date" value={deal.pricingEstimatedDate} mono />
            <div className="col-span-2">
              <Field label="Special Instructions" value={deal.specialInstructions} />
            </div>
          </dl>
        </Card>
      </div>

      {/* Workflow */}
      <Card>
        <CardHeader>
          <CardTitle>Workflow</CardTitle>
        </CardHeader>
        <WorkflowSection
          dealId={deal.id}
          dealStatus={deal.status}
          isOperator={isOperator ?? false}
          loadport={deal.loadport}
          dischargePort={deal.dischargePort}
        />
      </Card>

      {/* Change History + Audit */}
      <DealFooterSections deal={deal} />

      {/* Delete Deal Confirmation */}
      <Dialog
        open={deleteDealOpen}
        onClose={() => !deleteDealLoading && setDeleteDealOpen(false)}
        title="Delete this deal?"
        description="This will permanently remove the deal and all of its workflow steps, email drafts, and change history. This cannot be undone."
      >
        <div className="space-y-4">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-sm text-[var(--color-text-secondary)]">
            <div className="font-medium text-[var(--color-text-primary)] mb-1">
              {deal.counterparty} — {deal.direction.toUpperCase()} {deal.product}
            </div>
            <div className="text-xs font-mono text-[var(--color-text-tertiary)]">
              {Number(deal.quantityMt).toLocaleString()} MT · {deal.incoterm} · {deal.loadport}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setDeleteDealOpen(false)} disabled={deleteDealLoading}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteDeal}
              loading={deleteDealLoading}
            >
              Delete Deal
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

// ============================================================
// DOCUMENTS SECTION
// ============================================================

interface DocumentRecord {
  id: string;
  filename: string;
  fileType: string;
  storagePath: string;
  uploadedBy: string | null;
  createdAt: string;
}

const FILE_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  q88:      { label: "Q88",      color: "bg-blue-500/20 text-blue-400" },
  cp_recap: { label: "CP Recap", color: "bg-purple-500/20 text-purple-400" },
  bl:       { label: "B/L",      color: "bg-green-500/20 text-green-400" },
  coa:      { label: "COA",      color: "bg-amber-500/20 text-amber-400" },
  other:    { label: "Other",    color: "bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)]" },
};

function DocumentsSection({ dealId }: { dealId: string }) {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [newFilename, setNewFilename] = useState("");
  const [newFileType, setNewFileType] = useState("other");

  const fetchDocs = useCallback(() => {
    fetch(`/api/documents?dealId=${dealId}`)
      .then((r) => r.json())
      .then((data) => {
        setDocs(data.documents ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [dealId]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const handleUpload = async () => {
    if (!newFilename.trim()) return;
    setUploading(true);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          filename: newFilename.trim(),
          fileType: newFileType,
        }),
      });
      if (res.ok) {
        setNewFilename("");
        setNewFileType("other");
        setShowUploadForm(false);
        fetchDocs();
        toast.success("Document recorded");
      } else {
        const data = await res.json();
        toast.error(data.error ?? "Failed to record document");
      }
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setNewFilename(file.name);
      // Auto-detect type from filename
      const lower = file.name.toLowerCase();
      if (lower.includes("q88")) setNewFileType("q88");
      else if (lower.includes("cp") || lower.includes("recap")) setNewFileType("cp_recap");
      else if (lower.includes("bl") || lower.includes("bill")) setNewFileType("bl");
      else if (lower.includes("coa")) setNewFileType("coa");
      else setNewFileType("other");
      setShowUploadForm(true);
    }
    // Reset input so same file can be selected again
    e.target.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
          <CardTitle>Documents</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-tertiary)]">
            {docs.length} file{docs.length !== 1 ? "s" : ""}
          </span>
          <label className="cursor-pointer">
            <input
              type="file"
              className="hidden"
              onChange={handleFileSelect}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.eml,.msg,.txt,.csv"
            />
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--color-accent-muted)] text-[var(--color-accent-text)] hover:bg-[var(--color-accent)] hover:text-[var(--color-text-inverse)] transition-colors">
              <Upload className="h-3 w-3" />
              Upload
            </span>
          </label>
        </div>
      </CardHeader>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="h-4 w-4 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
        </div>
      ) : (
        <>
          {/* Upload form */}
          {showUploadForm && (
            <div className="mb-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] space-y-2">
              <div>
                <label className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">
                  Filename
                </label>
                <input
                  type="text"
                  value={newFilename}
                  onChange={(e) => setNewFilename(e.target.value)}
                  className="w-full mt-0.5 text-xs font-mono p-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-default)]"
                />
              </div>
              <div>
                <label className="text-[0.625rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">
                  Document Type
                </label>
                <select
                  value={newFileType}
                  onChange={(e) => setNewFileType(e.target.value)}
                  className="w-full mt-0.5 text-xs p-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-default)]"
                >
                  <option value="q88">Q88</option>
                  <option value="cp_recap">CP Recap</option>
                  <option value="bl">Bill of Lading</option>
                  <option value="coa">COA</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleUpload}
                  disabled={uploading || !newFilename.trim()}
                  className="text-xs font-medium px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-text-inverse)] hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {uploading ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => { setShowUploadForm(false); setNewFilename(""); }}
                  className="text-xs px-3 py-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Document list */}
          {docs.length === 0 && !showUploadForm ? (
            <div className="py-6 text-center">
              <FileText className="h-5 w-5 mx-auto text-[var(--color-text-tertiary)] mb-1.5" />
              <p className="text-xs text-[var(--color-text-tertiary)]">No documents attached</p>
            </div>
          ) : (
            <div className="space-y-1">
              {docs.map((doc) => {
                const badge = FILE_TYPE_BADGE[doc.fileType] ?? FILE_TYPE_BADGE.other;
                return (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 py-2 px-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-2)] transition-colors"
                  >
                    <FileText className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] flex-shrink-0" />
                    <span className="text-sm text-[var(--color-text-primary)] truncate flex-1 font-mono">
                      {doc.filename}
                    </span>
                    <span className={`text-[0.625rem] font-semibold px-1.5 py-0.5 rounded ${badge.color} uppercase tracking-wider`}>
                      {badge.label}
                    </span>
                    <span className="text-xs text-[var(--color-text-tertiary)] font-mono flex-shrink-0">
                      {new Date(doc.createdAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ============================================================
// SHARED FOOTER: CHANGE HISTORY + AUDIT LOG
// ============================================================

function DealFooterSections({ deal }: { deal: DealDetail }) {
  return (
    <>
      {/* Change History */}
      {deal.changeHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Change History</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {deal.changeHistory.map((change) => (
              <div
                key={change.id}
                className="flex items-center gap-3 py-2 border-b border-[var(--color-border-subtle)] last:border-0"
              >
                <ArrowRightLeft className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <span className="font-medium text-[var(--color-accent-text)]">{change.fieldChanged}</span>
                  <span className="text-[var(--color-text-tertiary)]"> changed from </span>
                  <span className="text-[var(--color-danger)] line-through">{change.oldValue || "empty"}</span>
                  <span className="text-[var(--color-text-tertiary)]"> to </span>
                  <span className="text-[var(--color-success)]">{change.newValue || "empty"}</span>
                </div>
                <span className="text-xs text-[var(--color-text-tertiary)] font-mono">
                  {new Date(change.createdAt).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Audit Log */}
      <Card>
        <CardHeader>
          <CardTitle>Audit Log</CardTitle>
          <span className="text-xs text-[var(--color-text-tertiary)]">
            {deal.auditLog.length} entries
          </span>
        </CardHeader>
        <div className="space-y-1.5">
          {deal.auditLog.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)] py-4 text-center">No entries yet</p>
          ) : (
            deal.auditLog.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 py-1.5 text-sm"
              >
                <Clock className="h-3 w-3 text-[var(--color-text-tertiary)] flex-shrink-0" />
                <span className="text-xs font-mono text-[var(--color-text-tertiary)] w-32 flex-shrink-0">
                  {new Date(entry.createdAt).toLocaleString("en-GB", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="text-[var(--color-text-secondary)]">{entry.action}</span>
                {entry.userName && (
                  <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">
                    {entry.userName}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [linkedDeals, setLinkedDeals] = useState<LinkedDeal[]>([]);
  const [linkage, setLinkage] = useState<LinkageDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDeal = useCallback(() => {
    // Cache-bust everything: this is called immediately after deal mutations
    // (create, edit, link rename) and stale reads cause silent corruption.
    const t = Date.now();
    fetch(`/api/deals/${id}?_t=${t}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(async (data) => {
        setDeal(data);

        // Prefer the stable linkageId FK for grouping — the linkageCode string can
        // drift after a linkage number update and would break the view. Fall back to
        // linkageCode only for legacy rows that predate the linkages table.
        if (data.linkageId) {
          try {
            const [dealsRes, linkageRes] = await Promise.all([
              fetch(`/api/deals?linkageId=${encodeURIComponent(data.linkageId)}&perPage=50&_t=${t}`, { cache: "no-store" }),
              fetch(`/api/linkages/${encodeURIComponent(data.linkageId)}?_t=${t}`, { cache: "no-store" }),
            ]);
            const linked = await dealsRes.json();
            setLinkedDeals(linked.items ?? []);
            if (linkageRes.ok) {
              setLinkage(await linkageRes.json());
            } else {
              setLinkage(null);
            }
          } catch {
            setLinkedDeals([]);
            setLinkage(null);
          }
        } else if (data.linkageCode) {
          try {
            const res = await fetch(`/api/deals?linkageCode=${encodeURIComponent(data.linkageCode)}&perPage=50&_t=${t}`, { cache: "no-store" });
            const linked = await res.json();
            setLinkedDeals(linked.items ?? []);
            setLinkage(null);
          } catch {
            setLinkedDeals([]);
            setLinkage(null);
          }
        } else {
          setLinkedDeals([]);
          setLinkage(null);
        }

        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchDeal();
  }, [fetchDeal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!deal) {
    return <p className="text-[var(--color-text-secondary)]">Deal not found</p>;
  }

  const canEdit = session?.user?.role === "operator" || session?.user?.role === "admin";
  const isOperator = canEdit;

  return (
    <SingleDealView
      deal={deal}
      canEdit={canEdit ?? false}
      isOperator={isOperator ?? false}
      fetchDeal={fetchDeal}
    />
  );
}
