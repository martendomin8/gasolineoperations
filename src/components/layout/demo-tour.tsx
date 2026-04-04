"use client";

/**
 * DemoTour — persistent automated tour orchestrator
 *
 * Lives in the authenticated layout so it NEVER unmounts across page
 * navigations. Uses sessionStorage to carry state through route changes
 * and usePathname() to detect when a navigation has completed.
 *
 * Start the tour by calling window.__startDemoTour() (wired up in the
 * layout's header button) or by pressing the floating "▶ Demo" button.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  TOUR_STEPS,
  getTourState,
  setTourState,
  clearTourState,
  type TourState,
} from "@/lib/tour";
import { X, ChevronRight, Play, Zap } from "lucide-react";

// ── helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ── component ─────────────────────────────────────────────────────────────

export function DemoTour() {
  const router = useRouter();
  const pathname = usePathname();

  const [state, setState] = useState<TourState | null>(null);
  const [progress, setProgress] = useState(0); // 0-100 within current step
  const [visible, setVisible] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingNavRef = useRef<string | null>(null);
  const awaitingNavRef = useRef(false);

  // ── persist state ──────────────────────────────────────────────────────

  const save = useCallback((s: TourState) => {
    setState(s);
    setTourState(s);
  }, []);

  // ── clear timers ──────────────────────────────────────────────────────

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (progressRef.current) clearInterval(progressRef.current);
    timerRef.current = null;
    progressRef.current = null;
  }, []);

  // ── stop tour ─────────────────────────────────────────────────────────

  const stopTour = useCallback(() => {
    clearTimers();
    clearTourState();
    setState(null);
    setVisible(false);
    setProgress(0);
    pendingNavRef.current = null;
    awaitingNavRef.current = false;
  }, [clearTimers]);

  // ── start progress bar for current step ───────────────────────────────

  const startProgress = useCallback((duration: number) => {
    setProgress(0);
    const interval = 100; // ms
    const steps = duration / interval;
    let tick = 0;
    progressRef.current = setInterval(() => {
      tick++;
      setProgress(Math.min(100, Math.round((tick / steps) * 100)));
      if (tick >= steps) {
        if (progressRef.current) clearInterval(progressRef.current);
      }
    }, interval);
  }, []);

  // ── execute a single step ─────────────────────────────────────────────

  const executeStep = useCallback(
    async (stepIndex: number, currentState: TourState) => {
      clearTimers();

      if (stepIndex >= TOUR_STEPS.length) {
        stopTour();
        return;
      }

      const step = TOUR_STEPS[stepIndex];

      // Determine the actual path to navigate to
      let targetPath = step.path;
      if (step.id === "shell-deal" || step.id === "generate-draft" || step.id === "view-draft") {
        if (currentState.shellDealId) {
          targetPath = `/deals/${currentState.shellDealId}`;
        } else {
          // Skip if we don't have the shell deal ID
          save({ ...currentState, stepIndex: stepIndex + 1 });
          executeStep(stepIndex + 1, currentState);
          return;
        }
      }
      if (step.id === "new-deal") {
        if (currentState.newDealId) {
          targetPath = `/deals/${currentState.newDealId}`;
        } else {
          // E2E hasn't navigated yet — we'll be called when it does
          return;
        }
      }

      // Navigate if needed
      if (targetPath && targetPath !== window.location.pathname) {
        pendingNavRef.current = targetPath;
        awaitingNavRef.current = true;
        router.push(targetPath);
        return; // wait for pathname change → useEffect will continue
      }

      // We're on the right page — execute the step
      if (step.scrollTop) {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      // Fire click target (after a settle delay; expand-draft gets extra time for API re-render)
      if (step.clickTarget) {
        const clickDelay = step.id === "view-draft" ? 2500 : 1200;
        await sleep(clickDelay);
        const el = document.querySelector(step.clickTarget) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          await sleep(600);
          el.click();
        }
      }

      // Dispatch custom event (e.g. trigger E2E parse)
      if (step.dispatchEvent) {
        await sleep(800);
        window.dispatchEvent(new CustomEvent(step.dispatchEvent));
      }

      // Start the dwell timer + progress bar
      startProgress(step.duration);

      // Special case: parse-run waits for "tour:deal-created" event instead of a fixed timer
      if (step.id === "parse-run") {
        // The parse page fires this when the deal has been created
        const onDealCreated = (e: Event) => {
          const detail = (e as CustomEvent<{ dealId: string }>).detail;
          clearTimers();
          const next: TourState = {
            ...currentState,
            stepIndex: stepIndex + 1,
            newDealId: detail.dealId,
          };
          save(next);
          // navigate to the new deal page (next step handles it)
          executeStep(stepIndex + 1, next);
        };
        window.addEventListener("tour:deal-created", onDealCreated, { once: true });

        // Fallback: if E2E doesn't fire within 30s, skip
        timerRef.current = setTimeout(() => {
          window.removeEventListener("tour:deal-created", onDealCreated);
          const next = { ...currentState, stepIndex: stepIndex + 1 };
          save(next);
          executeStep(stepIndex + 1, currentState);
        }, 30000);
        return;
      }

      // Normal step: advance after duration
      timerRef.current = setTimeout(() => {
        if (stepIndex + 1 >= TOUR_STEPS.length) {
          stopTour();
          return;
        }
        const next = { ...currentState, stepIndex: stepIndex + 1 };
        save(next);
        executeStep(stepIndex + 1, next);
      }, step.duration);
    },
    [clearTimers, router, save, startProgress, stopTour]
  );

  // ── react to pathname changes (navigation completed) ──────────────────

  useEffect(() => {
    if (!awaitingNavRef.current) return;
    if (!pendingNavRef.current) return;

    const expectedPath = pendingNavRef.current;
    if (!pathname.startsWith(expectedPath.split("?")[0])) return;

    awaitingNavRef.current = false;
    pendingNavRef.current = null;

    // Re-read state from sessionStorage (it was saved before navigation)
    const s = getTourState();
    if (!s?.running) return;

    setState(s);
    // Give the page a moment to render before interacting
    setTimeout(() => {
      executeStep(s.stepIndex, s);
    }, 600);
  }, [pathname, executeStep]);

  // ── start tour ────────────────────────────────────────────────────────

  const startTour = useCallback(async () => {
    // Look up the Shell deal (EG-2026-041) from the API
    let shellDealId: string | null = null;
    try {
      const res = await fetch("/api/deals?search=EG-2026-041&perPage=1");
      if (res.ok) {
        const data = await res.json();
        shellDealId = data.items?.[0]?.id ?? null;
      }
    } catch {
      /* ok, will skip shell deal step */
    }

    const initial: TourState = {
      running: true,
      stepIndex: 0,
      shellDealId,
      newDealId: null,
    };
    save(initial);
    setVisible(true);
    executeStep(0, initial);
  }, [executeStep, save]);

  // ── expose startTour globally for header button ────────────────────────

  useEffect(() => {
    // @ts-expect-error — intentional global
    window.__startDemoTour = startTour;
    return () => {
      // @ts-expect-error — cleanup
      delete window.__startDemoTour;
    };
  }, [startTour]);

  // ── restore tour if page reloaded mid-tour ────────────────────────────

  useEffect(() => {
    const s = getTourState();
    if (s?.running) {
      setState(s);
      setVisible(true);
      setTimeout(() => executeStep(s.stepIndex, s), 800);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── render: floating start button when not running ────────────────────

  if (!visible && !state?.running) {
    return (
      <button
        onClick={startTour}
        title="Run automated demo tour (2 min)"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full bg-[var(--color-accent)] text-white text-xs font-semibold shadow-lg hover:opacity-90 active:scale-95 transition-all"
      >
        <Play className="h-3.5 w-3.5 fill-white" />
        Demo Tour
      </button>
    );
  }

  // ── render: HUD overlay when running ─────────────────────────────────

  const stepIndex = state?.stepIndex ?? 0;
  const step = TOUR_STEPS[Math.min(stepIndex, TOUR_STEPS.length - 1)];
  const totalSteps = TOUR_STEPS.length;

  return (
    <>
      {/* Floating HUD */}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4 pointer-events-none">
        <div className="pointer-events-auto bg-[var(--color-surface-1)] border border-[var(--color-border-default)] rounded-2xl shadow-2xl overflow-hidden">
          {/* Progress bar */}
          <div className="h-0.5 bg-[var(--color-surface-2)]">
            <div
              className="h-full bg-[var(--color-accent)] transition-all duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex items-start gap-3 px-4 py-3">
            {/* Step indicator */}
            <div className="flex-shrink-0 mt-0.5">
              <div className="flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-[var(--color-accent)]" />
                <span className="text-[10px] font-mono text-[var(--color-text-tertiary)] uppercase tracking-wider">
                  {stepIndex + 1}/{totalSteps}
                </span>
              </div>
            </div>

            {/* Step content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-[var(--color-text-primary)] truncate">
                  {step.label}
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                {step.description}
              </p>
            </div>

            {/* Step dots */}
            <div className="flex-shrink-0 flex items-center gap-1 mt-1">
              {TOUR_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`rounded-full transition-all duration-300 ${
                    i < stepIndex
                      ? "w-1.5 h-1.5 bg-[var(--color-success)]"
                      : i === stepIndex
                      ? "w-2.5 h-1.5 bg-[var(--color-accent)]"
                      : "w-1.5 h-1.5 bg-[var(--color-border-default)]"
                  }`}
                />
              ))}
            </div>

            {/* Skip / close */}
            <button
              onClick={stopTour}
              title="Stop demo tour"
              className="flex-shrink-0 p-1 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Step progress mini-nav */}
          <div className="px-4 pb-2.5 flex items-center justify-between">
            <div className="flex gap-0.5">
              {TOUR_STEPS.map((s, i) => (
                <div
                  key={i}
                  className={`text-[9px] font-mono px-1 py-0.5 rounded transition-colors ${
                    i === stepIndex
                      ? "bg-[var(--color-accent-muted)] text-[var(--color-accent-text)]"
                      : i < stepIndex
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-text-tertiary)]"
                  }`}
                >
                  {i < stepIndex ? "✓" : i === stepIndex ? s.id : "·"}
                </div>
              ))}
            </div>
            <span className="text-[9px] text-[var(--color-text-tertiary)] font-mono uppercase tracking-wider flex items-center gap-1">
              <ChevronRight className="h-2.5 w-2.5" />
              auto-advancing
            </span>
          </div>
        </div>
      </div>

      {/* Subtle dim overlay to focus attention (doesn't block interaction) */}
      <div className="fixed inset-0 z-40 pointer-events-none bg-black/5" />
    </>
  );
}
