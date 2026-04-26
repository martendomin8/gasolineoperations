# Voyage Schematic Bar — Handoff

A single-row voyage progress component (~280 px tall). Drop-in for the
post-trade nominations UI. NEFGO Terminal aesthetic — graphite surface,
amber accent, IBM Plex Mono labels, IBM Plex Sans values.

**Reference:** see `nefgo-voyage-schematic-bar-reference.png` for the
target pixel result. The TSX file in this folder matches it 1:1 against
the project's existing CSS variables.

---

## How to install (paste this prompt into Claude Code)

> Add a new component `src/components/voyage/voyage-schematic-bar.tsx`
> using the file in `handoff/voyage-schematic-bar.tsx` exactly as-is.
>
> It expects the `ResolvedPort`, `VoyageState`, and `formatInPortTime`
> helpers already in the repo — match the import paths to wherever those
> live (likely `@/lib/voyage` and `@/lib/time`). If type names differ,
> alias them at the top of the file rather than rewriting the component.
>
> Then replace the current `VoyageProgress` block in
> `[wherever the existing voyage UI is mounted]` with this component,
> wired to the same data source. Keep the existing
> `Mark voyage completed` action button — render it next to the status
> pill in the header, not inside the component itself.
>
> Use lucide-react's `Anchor` icon for the vessel marker (already
> imported in the file). If the design system has a different "ship"
> icon, swap it in.
>
> Smoke test:
>   - sailing voyage at 58% globalProgress → marker sits at 58% with the
>     KN/NM caption visible
>   - completed voyage → status pill turns green, traveled bar full
>   - laycan blown (margin < 0) → margin tile turns red, status pill
>     reads OFF LAYCAN
>   - missing impliedSpeed → "—" with no unit
>
> Do NOT add a Storybook story unless I ask. Just the component file
> and the wiring.

---

## CSS variable map used

| Used in component                          | Project token              |
| ------------------------------------------ | -------------------------- |
| Surface (card background)                  | `--color-surface-1`        |
| Border (subtle)                            | `--color-border-subtle`    |
| Border (default)                           | `--color-border-default`   |
| Headline / value text                      | `--color-text-primary`     |
| Secondary text                             | `--color-text-secondary`   |
| Caption / micro-label                      | `--color-text-tertiary`    |
| Amber accent (track, marker, accent value) | `--color-accent`           |
| OK (completed phase)                       | Tailwind `emerald-400/500` |
| Alarm (blown laycan, unrealistic speed)    | Tailwind `red-400`         |

If your project uses different token names, search-and-replace inside
the file — the component has no hard-coded hex values.

---

## Props the component receives

```ts
interface SchematicBarProps {
  header: {
    voyageRef: string;       // "NOM-2541"
    vesselName: string;      // "MV STENA PROVIDENCE"
    productLabel: string;    // "37,500 MT EBOB"
    laycanRange: string;     // "23–27 APR"
    cpSpeedKn: number;       // 12
    totalDistanceNm: number; // 1140
  };
  stops: ResolvedPort[];     // ordered LOAD … DISCH
  state: VoyageState;
  formatInPortTime: (date: Date | null, portName: string) => string;
}
```

The component only reads `stops[0]` and `stops[stops.length - 1]` for
endpoint rendering — multi-leg voyages still work, the marker just
glides across the full distance using `state.globalProgress`.

---

## What's *not* included (and where it should live)

- **The `Mark voyage completed` button** — keep it in the parent. It's
  an action, not part of the progress display.
- **Voyage timeline rows (LOAD/DISCH detail lines under the bar)** —
  that's a separate component. This bar is the at-a-glance summary.
- **Add notes link** — parent.

---

## Layout sanity

- Min container width: 1024 px. At 1280 px the layout breathes nicely.
- Min container height: 280 px (header 70 + track area 140 + tiles 70).
- The vessel marker is clamped 2…98% so it never collides with the
  endpoint nodes.

---

## Edge cases handled

- `state.phase === "pre_voyage"` → status pill grey, no "ON LAYCAN" suffix
- `state.phase === "at_port"` → marker stays at the loading endpoint
- `state.phase === "completed"` → pill green, marker at 100%
- `eta` null → ETA tile shows "—", margin tile shows "—"
- `impliedSpeed` null → tile shows "—" with no KN unit
- `unrealisticSpeed: true` on next stop → implied-speed tile turns red
