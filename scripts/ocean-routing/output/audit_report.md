# Ocean Routing Audit — 2026-04-18 17:43

## Summary

- Critical: **3118**
- Warnings: **0**
- Info: **0**

By category:
- land: 1760
- detour: 1
- zigzag: 1354
- xtd: 0
- reference: 3

## Land Crossings (1760)

- **[CRITICAL]** `Sankt-Peterburg, RU|Skikda, DZ` — Segment 15 crosses land near (37.06, 6.37)
    seg 15: (38.50, 1.50) -> (36.88, 6.90)
- **[CRITICAL]** `Sankt-Peterburg, RU|Tuapse, RU` — Segment 15 crosses land near (36.70, 15.08)
    seg 15: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Gdansk, PL|Skikda, DZ` — Segment 14 crosses land near (37.06, 6.37)
    seg 14: (38.50, 1.50) -> (36.88, 6.90)
- **[CRITICAL]** `Gdansk, PL|Thessaloniki, GR` — Segment 14 crosses land near (36.70, 15.08)
    seg 14: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Gdansk, PL|Izmit, TR` — Segment 14 crosses land near (36.70, 15.08)
    seg 14: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Gdansk, PL|Novorossiysk, RU` — Segment 14 crosses land near (36.70, 15.08)
    seg 14: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Gdansk, PL|Tuapse, RU` — Segment 14 crosses land near (36.70, 15.08)
    seg 14: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Tallinn, EE|Thessaloniki, GR` — Segment 14 crosses land near (36.70, 15.08)
    seg 14: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Tallinn, EE|Tuapse, RU` — Segment 14 crosses land near (36.70, 15.08)
    seg 14: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Primorsk, RU|Skikda, DZ` — Segment 14 crosses land near (37.06, 6.37)
    seg 14: (38.50, 1.50) -> (36.88, 6.90)
- **[CRITICAL]** `Primorsk, RU|Thessaloniki, GR` — Segment 14 crosses land near (36.70, 15.08)
    seg 14: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Primorsk, RU|Tuapse, RU` — Segment 14 crosses land near (36.70, 15.08)
    seg 14: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Sankt-Peterburg, RU|Thessaloniki, GR` — Segment 14 crosses land near (36.87, 14.47)
    seg 14: (38.88, 8.81) -> (36.66, 14.99)
- **[CRITICAL]** `Porvoo, FI|Skikda, DZ` — Segment 14 crosses land near (37.06, 6.37)
    seg 14: (38.50, 1.50) -> (36.88, 6.90)
- **[CRITICAL]** `Porvoo, FI|Thessaloniki, GR` — Segment 14 crosses land near (36.70, 15.08)
    seg 14: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Porvoo, FI|Tuapse, RU` — Segment 14 crosses land near (36.70, 15.08)
    seg 14: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Klaipeda, LT|Skikda, DZ` — Segment 13 crosses land near (37.06, 6.37)
    seg 13: (38.50, 1.50) -> (36.88, 6.90)
- **[CRITICAL]** `Klaipeda, LT|Thessaloniki, GR` — Segment 13 crosses land near (36.70, 15.08)
    seg 13: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Klaipeda, LT|Novorossiysk, RU` — Segment 13 crosses land near (36.70, 15.08)
    seg 13: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Klaipeda, LT|Tuapse, RU` — Segment 13 crosses land near (36.70, 15.08)
    seg 13: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Ruwais, AE|Skaw, DK` — Segment 13 crosses land near (50.79, 0.23)
    seg 13: (48.80, -5.70) -> (51.11, 1.32)
- **[CRITICAL]** `Hamburg, DE|Skikda, DZ` — Segment 12 crosses land near (37.06, 6.37)
    seg 12: (38.50, 1.50) -> (36.88, 6.90)
- **[CRITICAL]** `Hamburg, DE|Thessaloniki, GR` — Segment 12 crosses land near (36.70, 15.08)
    seg 12: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Hamburg, DE|Izmit, TR` — Segment 12 crosses land near (36.70, 15.08)
    seg 12: (36.71, 14.68) -> (36.30, 22.50)
- **[CRITICAL]** `Hamburg, DE|Novorossiysk, RU` — Segment 12 crosses land near (36.70, 15.08)
    seg 12: (36.71, 14.68) -> (36.30, 22.50)

*...1735 more omitted (use --top to raise limit)*

## Unnecessarily Long Detours (1)

- **[CRITICAL]** `Guayanilla, PR|San Juan, PR` — Path is 2.17× the straight line (104 NM vs 48 NM direct)
    straight-line is sea-safe — detour not explained by land

## Zigzag / Backtracking (1354)

- **[CRITICAL]** `Montreal, CA|Portland, US` — 59.3% of path (352 NM) moves away from destination
- **[CRITICAL]** `Koper, SI|Le Havre, FR` — 58.0% of path (1402 NM) moves away from destination
- **[CRITICAL]** `Point Tupper, CA|San Francisco, US` — 56.5% of path (4465 NM) moves away from destination
- **[CRITICAL]** `Rotterdam, NL|Sarroch, IT` — 56.3% of path (1177 NM) moves away from destination
- **[CRITICAL]** `Halifax, CA|San Francisco, US` — 56.1% of path (4391 NM) moves away from destination
- **[CRITICAL]** `Antwerp, BE|Sarroch, IT` — 56.1% of path (1166 NM) moves away from destination
- **[CRITICAL]** `Baltimore, US|Los Angeles, US` — 56.0% of path (3955 NM) moves away from destination
- **[CRITICAL]** `Ghent, BE|Sarroch, IT` — 55.7% of path (1147 NM) moves away from destination
- **[CRITICAL]** `Flushing, NL|Sarroch, IT` — 55.4% of path (1136 NM) moves away from destination
- **[CRITICAL]** `Koper, SI|Rotterdam, NL` — 54.4% of path (1402 NM) moves away from destination
- **[CRITICAL]** `Dunkirk, FR|Sarroch, IT` — 54.3% of path (1085 NM) moves away from destination
- **[CRITICAL]** `Baltimore, US|Boston, US` — 53.8% of path (437 NM) moves away from destination
- **[CRITICAL]** `New York, US|San Francisco, US` — 53.8% of path (4011 NM) moves away from destination
- **[CRITICAL]** `Antwerp, BE|Lavera, FR` — 53.7% of path (1166 NM) moves away from destination
- **[CRITICAL]** `Antwerp, BE|Marseille, FR` — 53.7% of path (1166 NM) moves away from destination
- **[CRITICAL]** `Corpus Christi, US|Los Angeles, US` — 53.6% of path (3589 NM) moves away from destination
- **[CRITICAL]** `Baltimore, US|San Francisco, US` — 53.5% of path (3955 NM) moves away from destination
- **[CRITICAL]** `Baltimore, US|Montreal, CA` — 53.4% of path (658 NM) moves away from destination
- **[CRITICAL]** `Houston, US|Los Angeles, US` — 53.3% of path (3551 NM) moves away from destination
- **[CRITICAL]** `Ghent, BE|Lavera, FR` — 53.3% of path (1147 NM) moves away from destination
- **[CRITICAL]** `Ghent, BE|Marseille, FR` — 53.3% of path (1147 NM) moves away from destination
- **[CRITICAL]** `Flushing, NL|Lavera, FR` — 53.1% of path (1136 NM) moves away from destination
- **[CRITICAL]** `Flushing, NL|Marseille, FR` — 53.0% of path (1136 NM) moves away from destination
- **[CRITICAL]** `Genoa, IT|Le Havre, FR` — 52.7% of path (1130 NM) moves away from destination
- **[CRITICAL]** `Norfolk, US|San Francisco, US` — 52.7% of path (3830 NM) moves away from destination

*...1329 more omitted (use --top to raise limit)*

## Reference Distance Mismatches (3)

- **[CRITICAL]** `Genoa, IT|Marseille, FR` — Computed 287 NM vs reference 189 NM (+51.8% off)
- **[CRITICAL]** `Genoa, IT|Koper, SI` — Computed 553 NM vs reference 1060 NM (+47.8% off)
- **[CRITICAL]** `Belfast, GB|Fawley, GB` — Computed 439 NM vs reference 610 NM (+28.1% off)
