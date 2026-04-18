# Sphere-Graph Distance Validation

## Against hand-verified references (PUB 151 / Netpas)

| Route | Reference NM | New NM | Old NM | New err % | Old err % |
|---|---:|---:|---:|---:|---:|
| Amsterdam, NL → Thessaloniki, GR | 3170 | 3082 | 3081.5 | 🟢 -2.8% | -2.8% |
| Gibraltar, GI → Lagos, NG | 3176 | 3165 | 3164.8 | 🟢 -0.4% | -0.4% |
| Rotterdam, NL → Houston, US | 5022 | 4998 | 4997.9 | 🟢 -0.5% | -0.5% |
| Amsterdam, NL → Augusta, IT | 2515 | 2475 | 2475.2 | 🟢 -1.6% | -1.6% |
| Amsterdam, NL → Barcelona, ES | 1966 | 1948 | 1948.1 | 🟢 -0.9% | -0.9% |
| Amsterdam, NL → Algeciras, ES | 1453 | 1420 | 1420.2 | 🟢 -2.3% | -2.3% |
| Rotterdam, NL → New York, US | 3456 | 3283 | 3283.4 | 🟡 -5.0% | -5.0% |
| Antwerp, BE → Le Havre, FR | 220 | 182 | 181.9 | 🔴 -17.3% | -17.3% |
| Marseille, FR → Genoa, IT | 189 | 214 | 214.5 | 🔴 +13.5% | +13.5% |
| Marseille, FR → Alexandria, EG | 1510 | 1423 | 1423.4 | 🟡 -5.7% | -5.7% |
| Barcelona, ES → Naples, IT | 537 | 567 | 566.9 | 🟡 +5.6% | +5.6% |
| Las Palmas, ES → Dakar, SN | 862 | 945 | 944.6 | 🔴 +9.6% | +9.6% |
| Singapore, SG → Fujairah, AE | 3293 | 3388 | 3387.5 | 🟢 +2.9% | +2.9% |
| Rotterdam, NL → Gothenburg, SE | 483 | 468 | 468.4 | 🟡 -3.0% | -3.0% |

**New pipeline:** mean abs err = 5.1%, max = 17.3%, n = 14
**Old pipeline:** mean abs err = 5.1%, max = 17.3%, n = 14

## Divergence new vs old (>10% different)

| Route | Old NM | New NM | Δ NM | Δ % |
|---|---:|---:|---:|---:|

Total pairs with >10% divergence: **0**

Pairs in old but missing in new: **0**
Pairs in new but missing in old: **0**