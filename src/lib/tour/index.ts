// ============================================================
// Demo Tour — step definitions and session-storage state
// ============================================================

export type TourStepId =
  | "dashboard"
  | "shell-deal"
  | "generate-draft"
  | "view-draft"
  | "parse-page"
  | "parse-run"
  | "new-deal"
  | "finish";

export interface TourStep {
  id: TourStepId;
  /** Path to navigate to at start of this step (null = stay on current page) */
  path: string | null;
  /** How long to dwell on this step before auto-advancing (ms) */
  duration: number;
  /** Short label shown in the HUD badge */
  label: string;
  /** Longer description shown in the HUD */
  description: string;
  /** DOM selector to click after navigation (optional) */
  clickTarget?: string;
  /** Custom event to fire instead of/as well as a click */
  dispatchEvent?: string;
  /** Should the tour scroll to the top of the page on arrival? */
  scrollTop?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "dashboard",
    path: "/dashboard",
    duration: 6500,
    label: "Task Queue",
    description: "15 active cargoes · 20 open tasks · 3 laycan critical · 1 re-notification required",
    scrollTop: true,
  },
  {
    id: "shell-deal",
    path: null, // navigated to dynamically using seed deal EG-2026-041
    duration: 8000,
    label: "CIF Sale — Shell Trading",
    description: "Step 1 acknowledged — 4 nominations ready to send",
    scrollTop: true,
  },
  {
    id: "generate-draft",
    path: null, // same deal page
    duration: 3500,
    label: "Generating nomination draft…",
    description: "One click generates a professional terminal nomination email",
    clickTarget: "[data-tour='generate-draft']",
  },
  {
    id: "view-draft",
    path: null, // same deal page — draft just generated
    duration: 10000,
    label: "Nomination Draft — Ready to Review",
    description: "Professional CIF nomination with vessel, cargo, and documentary instructions",
    clickTarget: "[data-tour='expand-draft']",
  },
  {
    id: "parse-page",
    path: "/deals/parse",
    duration: 3000,
    label: "AI Deal Parsing",
    description: "Paste any trader email — AI extracts all fields instantly",
    scrollTop: true,
  },
  {
    id: "parse-run",
    path: null, // still on parse page
    duration: 35000, // event-driven: waits for tour:deal-created; includes 8s field-review pause
    label: "Parsing trader email…",
    description: "Extracting counterparty · ports · laycan · vessel · pricing…",
    dispatchEvent: "tour:run-e2e",
  },
  {
    id: "new-deal",
    path: null, // navigated to by the E2E handler after deal creation
    duration: 9500,
    label: "Deal Created + Workflow Instantiated",
    description: "Workflow steps generated automatically based on incoterm & direction",
    scrollTop: true,
  },
  {
    id: "finish",
    path: "/dashboard",
    duration: 5000,
    label: "Back to Dashboard",
    description: "New cargo added to active pipeline — all nomination tasks queued",
    scrollTop: true,
  },
];

// ──────────────────────────────────────────────────────────────
// Session-storage persistence
// ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "demo_tour_state";

export interface TourState {
  running: boolean;
  stepIndex: number;
  /** The deal ID of EG-2026-041 — looked up at tour start */
  shellDealId: string | null;
  /** The deal ID created by the E2E parse step */
  newDealId: string | null;
}

export function getTourState(): TourState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TourState) : null;
  } catch {
    return null;
  }
}

export function setTourState(state: TourState): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearTourState(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}
