// ============================================================
// Demo Tour — step definitions and session-storage state
// ============================================================

export type TourStepId =
  | "dashboard"
  | "linked-deal"
  | "generate-draft"
  | "view-draft"
  | "parse-page"
  | "parse-run"
  | "new-deal"
  | "excel-view"
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
    duration: 7000,
    label: "Operations Dashboard",
    description: "Linkages sorted by type — Sale · Purchase · Purchase+Sale · Own Terminal. Click any card to open the full voyage view.",
    scrollTop: true,
  },
  {
    id: "linked-deal",
    path: null, // navigated to dynamically — the first HOLBORN/SHELL linked deal
    duration: 9000,
    label: "Linked Voyage — Buy + Sell",
    description: "Purchase and sale on the same vessel. Voyage bar shows linkage number, vessel, operators, pricing. Qty summary and notes below.",
    scrollTop: true,
  },
  {
    id: "generate-draft",
    path: null, // same deal page
    duration: 6000,
    label: "Generating nomination draft…",
    description: "One click generates a professional terminal nomination email from the deal data. The system merges vessel, cargo, and documentary instruction fields into the template.",
    clickTarget: "[data-tour='generate-draft']",
  },
  {
    id: "view-draft",
    path: null, // same deal page — draft just generated
    duration: 14000,
    label: "Nomination Draft — Ready to Review",
    description: "Full email with To, Subject, and Body — ready to copy-paste into Outlook. After sending, the operator clicks 'Sent' to track it. If any deal field changes later, the system flags this step for re-notification.",
    clickTarget: "[data-tour='expand-draft']",
  },
  {
    id: "parse-page",
    path: "/deals/parse",
    duration: 3000,
    label: "AI Deal Parsing",
    description: "Drag & drop a trader email or paste the text. AI extracts every field — counterparty, quantity with tolerance, ports, pricing.",
    scrollTop: true,
  },
  {
    id: "parse-run",
    path: null, // still on parse page
    duration: 35000, // event-driven: waits for tour:deal-created
    label: "Parsing CFR sale email…",
    description: "Extracting counterparty · quantity +/-5% tolerance · ports · laycan · pricing formula…",
    dispatchEvent: "tour:run-e2e",
  },
  {
    id: "new-deal",
    path: null, // navigated to by the E2E handler after deal creation
    duration: 9000,
    label: "Deal Created — CFR Workflow Matched",
    description: "5 workflow steps auto-generated: clearance → nomination → inspector → agent → voyage orders. All visible immediately, no hard blocks.",
    scrollTop: true,
  },
  {
    id: "excel-view",
    path: "/excel",
    duration: 8000,
    label: "Gasoline Vessels List",
    description: "The operator's spreadsheet — color-coded sections, inline status editing, pricing tracking. Linked deals share the same color band.",
    scrollTop: true,
  },
  {
    id: "finish",
    path: "/dashboard",
    duration: 5000,
    label: "Back to Dashboard",
    description: "New cargo in the pipeline. All nomination tasks queued. Ready to operate.",
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
  /** The deal ID of the first linked deal (HOLBORN or similar) — looked up at tour start */
  linkedDealId: string | null;
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
