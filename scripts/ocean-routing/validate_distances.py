"""
Validate sphere-graph output against two truth sources:

  1. PUB 151 / Netpas reference distances (the handful of routes where
     we have hand-verified NM values).
  2. The previous build_composed_paths.py output (stored in the src/
     provider folder). Large divergences here are worth looking at —
     they mean the two pipelines disagree.

Writes a Markdown report with per-route rows and a summary.
"""

from __future__ import annotations

import json
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "output"
# Previous (composer) output that the frontend currently ships.
OLD_DIST_PATH = Path(__file__).parent.parent.parent / "src" / "lib" / "sea-distance" / "providers" / "ocean-routing" / "distances.json"


# Hand-curated truth values (NM). Netpas-verified where noted, otherwise
# PUB 151 (US Defense Mapping Agency table). Keys are alphabetically-
# sorted port pairs.
REFERENCE = {
    # Netpas verified
    ("Amsterdam, NL", "Thessaloniki, GR"): 3170,
    ("Gibraltar, GI", "Lagos, NG"): 3176,
    ("Rotterdam, NL", "Houston, US"): 5022,
    # PUB 151
    ("Amsterdam, NL", "Augusta, IT"): 2515,
    ("Amsterdam, NL", "Barcelona, ES"): 1966,
    ("Amsterdam, NL", "Algeciras, ES"): 1453,
    ("Rotterdam, NL", "New York, US"): 3456,
    ("Antwerp, BE", "Le Havre, FR"): 220,
    ("Marseille, FR", "Genoa, IT"): 189,
    ("Marseille, FR", "Alexandria, EG"): 1510,
    ("Barcelona, ES", "Naples, IT"): 537,
    ("Las Palmas, ES", "Dakar, SN"): 862,
    ("Singapore, SG", "Fujairah, AE"): 3293,
    ("Rotterdam, NL", "Gothenburg, SE"): 483,
}


def sorted_key(a: str, b: str) -> str:
    return f"{a}|{b}" if a < b else f"{b}|{a}"


def colour(err: float) -> str:
    if abs(err) < 3:
        return "🟢"
    if abs(err) < 8:
        return "🟡"
    return "🔴"


def main():
    new_path = OUTPUT_DIR / "distances.json"
    if not new_path.exists():
        raise SystemExit(f"Run build_sphere_graph.py first ({new_path} missing)")

    new = json.loads(new_path.read_text())
    old = json.loads(OLD_DIST_PATH.read_text()) if OLD_DIST_PATH.exists() else {}

    lines = ["# Sphere-Graph Distance Validation", ""]

    # ── Reference distance comparison ─────────────────────────
    lines.append("## Against hand-verified references (PUB 151 / Netpas)")
    lines.append("")
    lines.append("| Route | Reference NM | New NM | Old NM | New err % | Old err % |")
    lines.append("|---|---:|---:|---:|---:|---:|")

    new_errs = []
    old_errs = []
    for (a, b), ref_nm in REFERENCE.items():
        key = sorted_key(a, b)
        new_nm = new.get(key)
        old_nm = old.get(key)
        if new_nm is None:
            lines.append(f"| {a} → {b} | {ref_nm} | **MISSING** | {old_nm or '—'} | — | — |")
            continue
        new_err = (new_nm - ref_nm) / ref_nm * 100
        new_errs.append(abs(new_err))
        old_err_str = "—"
        if old_nm is not None:
            old_err = (old_nm - ref_nm) / ref_nm * 100
            old_errs.append(abs(old_err))
            old_err_str = f"{old_err:+.1f}%"
        lines.append(
            f"| {a} → {b} | {ref_nm} | {new_nm:.0f} | "
            f"{old_nm or '—'} | {colour(new_err)} {new_err:+.1f}% | {old_err_str} |"
        )

    lines.append("")
    if new_errs:
        lines.append(f"**New pipeline:** mean abs err = {sum(new_errs)/len(new_errs):.1f}%, "
                     f"max = {max(new_errs):.1f}%, n = {len(new_errs)}")
    if old_errs:
        lines.append(f"**Old pipeline:** mean abs err = {sum(old_errs)/len(old_errs):.1f}%, "
                     f"max = {max(old_errs):.1f}%, n = {len(old_errs)}")
    lines.append("")

    # ── Pipeline-vs-pipeline divergence ───────────────────────
    if old:
        lines.append("## Divergence new vs old (>10% different)")
        lines.append("")
        lines.append("| Route | Old NM | New NM | Δ NM | Δ % |")
        lines.append("|---|---:|---:|---:|---:|")

        big_diffs = []
        for key, new_nm in new.items():
            old_nm = old.get(key)
            if old_nm is None or old_nm == 0:
                continue
            diff = new_nm - old_nm
            diff_pct = diff / old_nm * 100
            if abs(diff_pct) > 10:
                big_diffs.append((key, old_nm, new_nm, diff, diff_pct))

        big_diffs.sort(key=lambda r: -abs(r[4]))
        for key, old_nm, new_nm, diff, diff_pct in big_diffs[:50]:
            marker = "🟢" if diff_pct < 0 else "🔴"   # new shorter = green
            lines.append(
                f"| {key} | {old_nm:.0f} | {new_nm:.0f} | {diff:+.0f} | {marker} {diff_pct:+.1f}% |"
            )

        lines.append("")
        lines.append(f"Total pairs with >10% divergence: **{len(big_diffs)}**")

        # Missing-from-new breakdown
        missing_in_new = [k for k in old if k not in new]
        missing_in_old = [k for k in new if k not in old]
        lines.append("")
        lines.append(f"Pairs in old but missing in new: **{len(missing_in_new)}**")
        lines.append(f"Pairs in new but missing in old: **{len(missing_in_old)}**")

    report_path = OUTPUT_DIR / "validation_report.md"
    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report written to {report_path}")

    # Concise terminal summary
    print(f"\nReference comparison ({len(new_errs)} routes):")
    if new_errs:
        print(f"  New: mean {sum(new_errs)/len(new_errs):.1f}%, max {max(new_errs):.1f}%")
    if old_errs:
        print(f"  Old: mean {sum(old_errs)/len(old_errs):.1f}%, max {max(old_errs):.1f}%")


if __name__ == "__main__":
    main()
