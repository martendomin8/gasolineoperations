"use client";

import { useState } from "react";
import { Send, Sparkles, BookOpen, AlertTriangle } from "lucide-react";

/**
 * CP Q&A Panel
 *
 * Sits below the CP Recap drop zone. The operator types a question
 * ("who appoints the loadport agent?") and the assistant answers by
 * reading the CP recap first, then the matching base charter-party
 * form (BPVOY4 today, others later) underneath. The answer always
 * cites which layer it came from.
 *
 * History is in-memory only — closing the linkage view discards it.
 * Persisting Q&A to the audit log is a v2 concern.
 */

interface QaTurn {
  question: string;
  answer: string;
  baseFormDetected: string | null;
  baseFormUsed: string | null;
  baseFormReady: boolean;
  /** Set when the API call failed and we couldn't get an answer. */
  error?: string;
}

const SUGGESTIONS = [
  "Who appoints the loadport agent?",
  "What is the demurrage time bar?",
  "How long is the laytime?",
  "What's the cancelling-date extension mechanic?",
  "Who pays additional war-risk premium?",
];

export function CpQaPanel({
  linkageId,
  canEdit,
}: {
  linkageId: string;
  canEdit: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<QaTurn[]>([]);
  const [loading, setLoading] = useState(false);

  const submit = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/linkages/${linkageId}/cp-qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setHistory((prev) => [
          {
            question: trimmed,
            answer: "",
            baseFormDetected: null,
            baseFormUsed: null,
            baseFormReady: false,
            error: data.error ?? `Request failed (${res.status})`,
          },
          ...prev,
        ]);
      } else {
        setHistory((prev) => [
          {
            question: trimmed,
            answer: data.answer ?? "",
            baseFormDetected: data.baseFormDetected ?? null,
            baseFormUsed: data.baseFormUsed ?? null,
            baseFormReady: Boolean(data.baseFormReady),
          },
          ...prev,
        ]);
      }
      setQuestion("");
    } catch (err) {
      setHistory((prev) => [
        {
          question: trimmed,
          answer: "",
          baseFormDetected: null,
          baseFormUsed: null,
          baseFormReady: false,
          error: err instanceof Error ? err.message : "Network error",
        },
        ...prev,
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd+Enter / Ctrl+Enter sends. Plain Enter inserts a newline so the
    // operator can paste multi-paragraph context if needed.
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit(question);
    }
  };

  return (
    <div className="rounded-[var(--radius-md)] border border-violet-500/30 bg-[var(--color-surface-2)] px-3 py-3 text-xs">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-violet-400" />
        <span className="text-[0.7rem] uppercase tracking-wide text-violet-300 font-semibold">
          Ask AI about this CP
        </span>
        <span className="text-[0.6rem] text-[var(--color-text-tertiary)] ml-auto">
          Reads CP recap → base form (BPVOY4 etc.) → cites source
        </span>
      </div>

      <div className="relative">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!canEdit || loading}
          placeholder={
            canEdit
              ? "e.g. Who appoints the loadport agent? · What's the demurrage time bar?"
              : "Read-only access — cannot ask questions"
          }
          rows={2}
          className="w-full bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-violet-500/60 disabled:opacity-50 resize-y"
        />
        <button
          onClick={() => submit(question)}
          disabled={!canEdit || loading || question.trim().length < 3}
          className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-violet-300 text-[0.65rem] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Asking…" : (
            <>
              <Send className="h-3 w-3" /> Ask
            </>
          )}
        </button>
      </div>
      <div className="mt-1 text-[0.6rem] text-[var(--color-text-tertiary)]">
        ⌘/Ctrl + Enter to send. Suggestions:
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setQuestion(s);
            }}
            disabled={!canEdit || loading}
            className="ml-1 underline hover:text-violet-400 disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>

      {history.length > 0 && (
        <div className="mt-3 space-y-2">
          {history.map((turn, i) => (
            <div
              key={`${i}-${turn.question.slice(0, 30)}`}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-2.5 py-2"
            >
              <div className="text-[0.65rem] text-[var(--color-text-tertiary)] mb-1">
                Q: <span className="text-[var(--color-text-secondary)] font-medium">{turn.question}</span>
              </div>
              {turn.error ? (
                <div className="flex items-start gap-1.5 text-[0.7rem] text-red-400">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  <span>{turn.error}</span>
                </div>
              ) : (
                <>
                  <div className="text-[0.7rem] text-[var(--color-text-primary)] whitespace-pre-wrap leading-snug">
                    {turn.answer}
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[0.6rem] text-[var(--color-text-tertiary)]">
                    <BookOpen className="h-3 w-3" />
                    {turn.baseFormDetected
                      ? `Base form: ${turn.baseFormDetected}${turn.baseFormReady ? "" : " (reference not available — answered from recap only)"}`
                      : "Base form: not detected — answered from recap only"}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
