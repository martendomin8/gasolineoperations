"use client";

// WorkflowChips — Lauri-style clickable chip stack rendered inside each
// DealCard. Replaces the previous flex-wrap of small status pills with
// large action buttons that match the demo target (one click opens the
// chip's email-draft panel; Phase 1.10 wires the actual draft generation).
//
// A chip is one operator-clickable email-drafting action. Receive/gate/
// auto events are NOT chips — they happen in the background and the
// parser fills the deal data from dropped documents.
//
// Statuses + colours mirror Lauri's screenshot (per Arne's confirmation):
//   - pending          → indigo outline (calling for action)
//   - ready            → indigo outline + soft pulse (data ready, click to draft)
//   - draft_generated  → blue solid (draft saved, ready to send)
//   - sent             → green (already sent)
//   - acknowledged     → green darker (counterparty replied)
//   - received         → green-emerald (operator marked received)
//   - done             → green (manual done)
//   - needs_update     → red + pulse (data changed, re-send required)
//   - cancelled        → red strikethrough (cancellation email sent)
//   - na               → grey muted (chip suppressed by conditional logic)

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, Send, AlertTriangle, Check, Mail, Users, Copy, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

// Minimal shape — keeps the chip stack decoupled from the full DB row so
// any caller can hand it a /api/deals/:id/workflow response without
// pulling in every server-side column.
export interface WorkflowChipStep {
  id: string;
  stepOrder: number;
  stepName: string;
  stepType: string;
  status: string;
  recipientPartyType: string | null;
  description?: string | null;
  sentAt?: string | null;
  emailDraftId?: string | null;
  emailTemplateId?: string | null;
  assignedPartyId?: string | null;
}

interface DraftPayload {
  id: string;
  subject: string;
  body: string;
  toAddresses: string;
  ccAddresses?: string | null;
  status: string;
}

type PartyType = "terminal" | "agent" | "inspector" | "broker" | "counterparty";

const STATUS_STYLES: Record<string, string> = {
  pending: "border-indigo-500/30 bg-indigo-500/5 text-indigo-300 hover:bg-indigo-500/10 hover:border-indigo-500/50",
  blocked: "border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] cursor-not-allowed opacity-60",
  ready: "border-indigo-500/40 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20 hover:border-indigo-500/60",
  draft_generated: "border-blue-500/40 bg-blue-500/15 text-blue-200 hover:bg-blue-500/25",
  sent: "border-green-500/40 bg-green-500/15 text-green-300 hover:bg-green-500/25",
  acknowledged: "border-green-600/50 bg-green-600/20 text-green-200 hover:bg-green-600/30",
  received: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25",
  done: "border-green-500/40 bg-green-500/15 text-green-300 hover:bg-green-500/25",
  needs_update: "border-red-500/50 bg-red-500/15 text-red-300 hover:bg-red-500/25 animate-pulse",
  cancelled: "border-red-500/30 bg-red-500/5 text-red-400/70 line-through cursor-not-allowed",
  na: "border-[var(--color-border-subtle)] bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] opacity-60",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "to send",
  blocked: "blocked",
  ready: "ready to draft",
  draft_generated: "draft ready",
  sent: "sent",
  acknowledged: "acknowledged",
  received: "received",
  done: "done",
  needs_update: "re-send!",
  cancelled: "cancelled",
  na: "n/a",
};

const PARTY_LABEL: Record<PartyType, string> = {
  terminal: "terminal",
  agent: "agent",
  inspector: "inspector",
  broker: "broker",
  counterparty: "buyer/seller",
};

// Chip rendered as a button. Click opens the panel.
interface ChipProps {
  step: WorkflowChipStep;
  onClick: () => void;
}

function Chip({ step, onClick }: ChipProps) {
  const style = STATUS_STYLES[step.status] ?? STATUS_STYLES.pending;
  const isDisabled = step.status === "blocked" || step.status === "cancelled" || step.status === "na";
  const recipient = PARTY_LABEL[step.recipientPartyType as PartyType] ?? step.recipientPartyType ?? "—";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={`group w-full text-left px-3 py-2 rounded-[var(--radius-md)] border text-xs font-medium transition-all ${style}`}
    >
      <div className="flex items-start gap-2">
        <span className="flex-1 leading-snug">{step.stepName}</span>
        {step.status === "needs_update" && <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
        {(step.status === "sent" || step.status === "done" || step.status === "received" || step.status === "acknowledged") && (
          <Check className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-70">
        <span>→ {recipient}</span>
        <span>·</span>
        <span>{STATUS_LABEL[step.status] ?? step.status}</span>
      </div>
    </button>
  );
}

interface WorkflowChipsProps {
  dealId: string;
  steps: WorkflowChipStep[];
  /** Refetch parent deal/linkage data after a chip action that changed state. */
  onUpdated?: () => void;
}

export function WorkflowChips({ dealId, steps, onUpdated }: WorkflowChipsProps) {
  const [activeStep, setActiveStep] = useState<WorkflowChipStep | null>(null);

  // Chip ordering: respect the template's stepOrder. Lauri's UI groups
  // some chips side-by-side (parallel-ish steps) but for V1 we keep a
  // single vertical stack for clarity. Side-by-side rendering can come
  // later when chip layout metadata is added to the template.
  const ordered = useMemo(
    () => [...steps].sort((a, b) => a.stepOrder - b.stepOrder),
    [steps]
  );

  const sentCount = ordered.filter(
    (s) => s.status === "sent" || s.status === "done" || s.status === "received" || s.status === "acknowledged"
  ).length;
  const needsUpdateCount = ordered.filter((s) => s.status === "needs_update").length;
  const pct = ordered.length > 0 ? Math.round((sentCount / ordered.length) * 100) : 0;

  if (ordered.length === 0) {
    return (
      <div className="px-4 pb-3 pt-2 border-t border-[var(--color-border-subtle)] text-xs text-[var(--color-text-tertiary)]">
        No workflow yet — drop the deal recap to instantiate the chip flow.
      </div>
    );
  }

  return (
    <>
      <div className="px-4 pb-3 pt-2 border-t border-[var(--color-border-subtle)]">
        {/* Header — workflow progress + needs-update count */}
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
              {sentCount}/{ordered.length}
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

        {/* Vertical chip stack (Lauri-style — one click = one action) */}
        <div className="space-y-1.5">
          {ordered.map((step) => (
            <Chip key={step.id} step={step} onClick={() => setActiveStep(step)} />
          ))}
        </div>
      </div>

      {/* Chip action panel — wired to the draft-generation flow.
          - Existing draft (step.emailDraftId) → fetch + display.
          - No draft yet → "Generate draft" button calls
            /api/workflows/steps/:stepId with action=generate_draft,
            then we GET the new draft and show it.
          - Operator can copy to clipboard, regenerate, and mark as sent. */}
      {activeStep && (
        <ChipActionPanel
          step={activeStep}
          dealId={dealId}
          onClose={() => setActiveStep(null)}
          onUpdated={() => onUpdated?.()}
        />
      )}
    </>
  );
}

interface ChipActionPanelProps {
  step: WorkflowChipStep;
  dealId: string;
  onClose: () => void;
  onUpdated: () => void;
}

function ChipActionPanel({ step, dealId, onClose, onUpdated }: ChipActionPanelProps) {
  void dealId; // Reserved for Phase 2 (parser-augmented drafts pulling from linkage docs).

  const recipient = PARTY_LABEL[step.recipientPartyType as PartyType] ?? step.recipientPartyType ?? "—";

  const [draft, setDraft] = useState<DraftPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [marking, setMarking] = useState(false);
  const [editedSubject, setEditedSubject] = useState<string>("");
  const [editedBody, setEditedBody] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const loadExistingDraft = useCallback(
    async (draftId: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/email-drafts/${draftId}`);
        if (!res.ok) {
          setError("Could not load existing draft.");
          return;
        }
        const data = await res.json();
        const d: DraftPayload = {
          id: data.draft?.id ?? data.id,
          subject: data.draft?.subject ?? data.subject ?? "",
          body: data.draft?.body ?? data.body ?? "",
          toAddresses: data.draft?.toAddresses ?? data.toAddresses ?? "",
          ccAddresses: data.draft?.ccAddresses ?? data.ccAddresses ?? null,
          status: data.draft?.status ?? data.status ?? "draft",
        };
        setDraft(d);
        setEditedSubject(d.subject);
        setEditedBody(d.body);
      } catch {
        setError("Network error while loading draft.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // On open: if the step already has a draft, load it; otherwise wait for "Generate".
  useEffect(() => {
    if (step.emailDraftId) {
      void loadExistingDraft(step.emailDraftId);
    }
  }, [step.emailDraftId, loadExistingDraft]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/workflows/steps/${step.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_draft" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Failed to generate draft.");
        toast.error(data?.error ?? "Failed to generate draft.");
        return;
      }
      if (data?.draftId) {
        await loadExistingDraft(data.draftId);
        toast.success("Draft generated — review and send from Outlook.");
        onUpdated();
      } else {
        setError("Server did not return a draft ID.");
      }
    } catch {
      setError("Network error while generating draft.");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!draft) return;
    const composed = [
      `To: ${draft.toAddresses}`,
      ...(draft.ccAddresses ? [`Cc: ${draft.ccAddresses}`] : []),
      `Subject: ${editedSubject}`,
      ``,
      editedBody,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(composed);
      toast.success("Copied to clipboard — paste into Outlook.");
    } catch {
      toast.error("Could not access clipboard.");
    }
  };

  const handleMarkSent = async () => {
    setMarking(true);
    try {
      const res = await fetch(`/api/workflows/steps/${step.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_sent" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to mark as sent.");
        return;
      }
      toast.success("Marked as sent.");
      onUpdated();
      onClose();
    } catch {
      toast.error("Network error.");
    } finally {
      setMarking(false);
    }
  };

  const isSent = step.status === "sent" || step.status === "acknowledged" || step.status === "done" || step.status === "received";
  const isCancelled = step.status === "cancelled" || step.status === "na";
  const canGenerate = !isCancelled && !draft && !generating;
  const canRegenerate = !isCancelled && draft && !generating && step.status !== "sent";
  const canSend = draft && !isSent && !marking;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center px-4 py-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={step.stepName}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
          <div className="flex items-center gap-2 min-w-0">
            <Mail className="h-4 w-4 text-[var(--color-accent)] shrink-0" />
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
              {step.stepName}
            </h3>
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] flex items-center gap-1 shrink-0">
              <Users className="h-3 w-3" /> {recipient}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] rounded"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm text-[var(--color-text-secondary)]">
          {step.description && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">
                What this chip does
              </div>
              <p className="text-xs leading-relaxed">{step.description}</p>
            </div>
          )}

          {/* Empty state — no draft yet */}
          {!draft && !loading && !generating && (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-6 text-center">
              <Mail className="h-6 w-6 mx-auto mb-2 text-[var(--color-text-tertiary)]" />
              <p className="text-xs text-[var(--color-text-secondary)]">
                No draft yet. Click <span className="font-semibold">Generate draft</span> below to compose
                an email using the deal's data + the {recipient} contact details + the email template.
              </p>
              <p className="text-[10px] mt-2 text-[var(--color-text-tertiary)]">
                Phase 2 will augment the draft with parsed-document context (vessel nomination, doc
                instructions) and inline source citations.
              </p>
            </div>
          )}

          {/* Loading existing draft */}
          {(loading || generating) && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-6 text-center">
              <Loader2 className="h-5 w-5 mx-auto mb-2 text-[var(--color-text-tertiary)] animate-spin" />
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {generating ? "Generating draft…" : "Loading draft…"}
              </p>
            </div>
          )}

          {/* Error state */}
          {error && !generating && (
            <div className="rounded-[var(--radius-md)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {/* Draft editor */}
          {draft && !loading && (
            <div className="space-y-3">
              <div className="grid grid-cols-[60px_1fr] gap-x-2 gap-y-1 text-xs">
                <span className="text-[var(--color-text-tertiary)] uppercase tracking-wider">To</span>
                <span className="font-mono text-[var(--color-text-primary)] break-all">
                  {draft.toAddresses}
                </span>
                {draft.ccAddresses && (
                  <>
                    <span className="text-[var(--color-text-tertiary)] uppercase tracking-wider">Cc</span>
                    <span className="font-mono text-[var(--color-text-primary)] break-all">
                      {draft.ccAddresses}
                    </span>
                  </>
                )}
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] block mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={editedSubject}
                  onChange={(e) => setEditedSubject(e.target.value)}
                  disabled={isSent}
                  className="w-full px-2 py-1.5 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded text-[var(--color-text-primary)] disabled:opacity-60"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] block mb-1">
                  Body
                </label>
                <textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  disabled={isSent}
                  rows={14}
                  className="w-full px-2 py-1.5 text-xs font-mono bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded text-[var(--color-text-primary)] disabled:opacity-60 resize-y"
                />
              </div>

              {isSent && (
                <div className="text-[10px] text-green-400 flex items-center gap-1.5">
                  <Check className="h-3 w-3" />
                  Already marked as {STATUS_LABEL[step.status] ?? step.status}
                  {step.sentAt && ` on ${new Date(step.sentAt).toLocaleString()}`}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]"
          >
            Close
          </button>
          <span className="flex-1" />
          {canGenerate && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-indigo-500/80 hover:bg-indigo-500 text-white inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <Mail className="h-3 w-3" />
              Generate draft
            </button>
          )}
          {canRegenerate && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] inline-flex items-center gap-1.5"
              title="Regenerate from current deal data"
            >
              <RefreshCw className="h-3 w-3" />
              Regenerate
            </button>
          )}
          {draft && (
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-[var(--color-surface-3)] hover:bg-[var(--color-surface-2)] text-[var(--color-text-primary)] inline-flex items-center gap-1.5"
            >
              <Copy className="h-3 w-3" />
              Copy to Outlook
            </button>
          )}
          {canSend && (
            <button
              type="button"
              onClick={handleMarkSent}
              disabled={marking}
              className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-green-600/80 hover:bg-green-600 text-white inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              <Send className="h-3 w-3" />
              Mark as sent
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
