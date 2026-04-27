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

import { useMemo, useState } from "react";
import { X, Send, Clock, AlertTriangle, Check, Mail, Users } from "lucide-react";

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
}

export function WorkflowChips({ dealId, steps }: WorkflowChipsProps) {
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

      {/* Chip action panel — placeholder for Phase 1.10. Click a chip,
          panel opens with the step name + description. Phase 1.10 will
          replace this with the full email draft generation flow that
          uses parsed document data + deal data + party contacts to
          pre-fill the email body and recipient list. */}
      {activeStep && (
        <ChipActionPanel
          step={activeStep}
          dealId={dealId}
          onClose={() => setActiveStep(null)}
        />
      )}
    </>
  );
}

interface ChipActionPanelProps {
  step: WorkflowChipStep;
  dealId: string;
  onClose: () => void;
}

function ChipActionPanel({ step, dealId, onClose }: ChipActionPanelProps) {
  void dealId; // Phase 1.10 consumes this for draft generation.

  const recipient = PARTY_LABEL[step.recipientPartyType as PartyType] ?? step.recipientPartyType ?? "—";

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
        className="w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] shadow-2xl"
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

        {/* Body — Phase 1.9 placeholder. Phase 1.10 wires this up to
            POST /api/deals/:id/workflow-steps/:stepId/draft which
            generates a real email body using deal data + parsed
            documents + party contacts. */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm text-[var(--color-text-secondary)]">
          {step.description && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)] mb-1">
                What this chip does
              </div>
              <p className="text-xs leading-relaxed">{step.description}</p>
            </div>
          )}

          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-6 text-center">
            <Clock className="h-6 w-6 mx-auto mb-2 text-[var(--color-text-tertiary)]" />
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Email draft generation lands in Phase 1.10.
            </p>
            <p className="text-[10px] mt-1 text-[var(--color-text-tertiary)]">
              Click will then auto-fill the recipient list, subject, and body
              from parsed documents + deal data + contacts catalog. Operator
              reviews and sends from Outlook.
            </p>
          </div>

          {/* Status info */}
          <div className="text-[10px] text-[var(--color-text-tertiary)] grid grid-cols-2 gap-2">
            <div>
              <span className="uppercase tracking-wider">Step</span>
              <div className="text-[var(--color-text-secondary)] mt-0.5">
                {step.stepOrder}/{step.stepType}
              </div>
            </div>
            <div>
              <span className="uppercase tracking-wider">Status</span>
              <div className="text-[var(--color-text-secondary)] mt-0.5">
                {STATUS_LABEL[step.status] ?? step.status}
              </div>
            </div>
            {step.sentAt && (
              <div className="col-span-2">
                <span className="uppercase tracking-wider">Last sent</span>
                <div className="text-[var(--color-text-secondary)] mt-0.5">
                  {new Date(step.sentAt).toLocaleString()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]"
          >
            Close
          </button>
          <button
            type="button"
            disabled
            className="px-3 py-1.5 text-xs rounded-[var(--radius-md)] bg-indigo-500/30 text-indigo-300 opacity-60 cursor-not-allowed inline-flex items-center gap-1.5"
            title="Wired up in Phase 1.10"
          >
            <Send className="h-3 w-3" />
            Generate draft (1.10)
          </button>
        </div>
      </div>
    </div>
  );
}
