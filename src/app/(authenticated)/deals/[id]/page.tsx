"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import type { DealStatus, WorkflowStepStatus } from "@/lib/db/schema";
import type { WorkflowInstanceDetail, WorkflowStepWithDraft } from "@/lib/workflow-engine";

interface DealDetail {
  id: string;
  externalRef: string | null;
  counterparty: string;
  direction: string;
  product: string;
  quantityMt: string;
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
  specialInstructions: string | null;
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

interface WorkflowStepCardProps {
  step: WorkflowStepWithDraft;
  onAction: (stepId: string, action: string, extra?: Record<string, unknown>) => Promise<void>;
  isOperator: boolean;
}

function WorkflowStepCard({ step, onAction, isOperator }: WorkflowStepCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftEdits, setDraftEdits] = useState({ toAddresses: "", subject: "", body: "" });
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [parties, setParties] = useState<Party[]>([]);
  const [loadingParties, setLoadingParties] = useState(false);

  const cfg = STATUS_CONFIG[step.status] ?? STATUS_CONFIG.pending;
  const TypeIcon = STEP_TYPE_ICON[step.stepType] ?? Mail;
  const isBlocked = step.status === "blocked" || step.status === "pending";
  const isDone = step.status === "acknowledged" || (step.status === "sent" && !step.isExternalWait);
  const canAssignParty = isOperator && !isDone;

  const handleAction = async (action: string, extra?: Record<string, unknown>) => {
    setLoading(true);
    try {
      await onAction(step.id, action, extra);
    } finally {
      setLoading(false);
    }
  };

  const loadParties = async () => {
    if (parties.length > 0) return;
    setLoadingParties(true);
    try {
      const res = await fetch(`/api/parties?type=${step.recipientPartyType}&limit=100`);
      const data = await res.json();
      setParties(data.parties ?? []);
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
      {/* Step header */}
      <div className="flex items-center gap-3 p-3">
        {/* Step type icon */}
        <div
          className={`h-8 w-8 rounded-[var(--radius-sm)] flex items-center justify-center flex-shrink-0 ${
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
            className={`h-4 w-4 ${
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

        {/* Name + metadata */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-sm font-medium ${
                isBlocked ? "text-[var(--color-text-tertiary)]" : "text-[var(--color-text-primary)]"
              }`}
            >
              {step.stepName}
            </span>
            {step.isExternalWait && (
              <span className="text-[0.625rem] font-mono px-1.5 py-0.5 rounded bg-[var(--color-info-muted)] text-[var(--color-info)] uppercase tracking-wider">
                Ext. Wait
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
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
            {step.status === "blocked" && step.blockedByStepName && (
              <span className="text-xs text-[var(--color-text-tertiary)]">
                · blocked by <span className="italic">{step.blockedByStepName}</span>
              </span>
            )}
            {step.status === "needs_update" && (
              <span className="text-xs text-[var(--color-danger)]">· deal fields changed, re-send required</span>
            )}
          </div>
        </div>

        {/* Status badge + actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant={cfg.color as any} dot>
            {cfg.label}
          </Badge>

          {isOperator && !isBlocked && (
            <div className="flex items-center gap-1">
              {(step.status === "ready" || step.status === "needs_update") && step.emailTemplateId && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleAction("generate_draft")}
                  disabled={loading}
                >
                  <Mail className="h-3 w-3" />
                  Draft
                </Button>
              )}
              {(step.status === "ready" || step.status === "draft_generated") && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleAction("mark_sent")}
                  disabled={loading}
                >
                  <Send className="h-3 w-3" />
                  Sent
                </Button>
              )}
              {step.status === "sent" && step.isExternalWait && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleAction("mark_acknowledged")}
                  disabled={loading}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Received
                </Button>
              )}
              {step.status === "needs_update" && step.emailDraft && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleAction("mark_sent")}
                  disabled={loading}
                >
                  <RefreshCw className="h-3 w-3" />
                  Re-sent
                </Button>
              )}
            </div>
          )}

          {/* Expand toggle */}
          {hasExpandContent && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] transition-colors"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
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
                {loadingParties && <option disabled>Loading…</option>}
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.port ? ` (${p.port})` : ""}
                  </option>
                ))}
              </select>
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
        </div>
      )}
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
}

function WorkflowSection({ dealId, dealStatus, isOperator }: WorkflowSectionProps) {
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
        if (data.emailMode === "sent") {
          toast.success("Email sent", { description: "Delivered via Resend" });
        } else if (data.emailMode === "demo") {
          toast.success("Email logged (demo mode)", { description: "Set RESEND_API_KEY to send real emails" });
        } else {
          toast.info("Step marked sent — no draft to send");
        }
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
    (s) => s.status === "sent" || s.status === "acknowledged"
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
        <span className="text-xs text-[var(--color-text-tertiary)] flex-shrink-0">
          {workflow.templateName}
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
                onAction={(sid, action, extra) => handleStepAction(sid, action, extra)}
                isOperator={isOperator}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: session } = useSession();
  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDeal = useCallback(() => {
    fetch(`/api/deals/${id}`)
      .then((r) => r.json())
      .then((data) => { setDeal(data); setLoading(false); })
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
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/deals"
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
          {canEdit && (
            <Link href={`/deals/${id}/edit`}>
              <Button variant="secondary" size="md">
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            </Link>
          )}
        </div>

        {/* Status progression bar */}
        <div className="pl-1">
          <StatusStepper
            status={deal.status}
            version={deal.version}
            dealId={deal.id}
            canEdit={canEdit ?? false}
            onAdvanced={fetchDeal}
          />
        </div>
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

        <Card>
          <CardHeader>
            <CardTitle>Additional</CardTitle>
          </CardHeader>
          <dl className="space-y-3">
            <Field label="Pricing Formula" value={deal.pricingFormula} />
            <Field label="Special Instructions" value={deal.specialInstructions} />
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
        />
      </Card>

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
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
