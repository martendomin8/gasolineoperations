# Maritime Distance + Fleet Intelligence — Roadmap

> **Status**: Living document. Captures the long-term vision for NEFGO's
> in-house maritime intelligence stack (Netpas alternative + MarineTraffic
> alternative + Windy-inspired weather, integrated into the ops platform).
>
> **Companion docs**: `V1-VISION.md` (product positioning), `CLAUDE.md`
> (architecture + domain).

---

## Guiding philosophy

**Build in-house, commercially-usable, on-premise-deployable.** Every
maritime data source has a commercial equivalent we could license
(Netpas, MarineTraffic, Windy), but for the price of a 1-year enterprise
subscription we can build our own open-stack version that:

1. Has no per-seat / per-client licensing cost
2. Can run on-premise (client's own servers, no external dependency)
3. Is customizable for tanker-ops-specific workflows
4. Becomes a moat: proprietary data (our AIS receiver network) +
   ops-tailored UX

Every external provider we integrate with must be **swappable**. Same
pattern as CLAUDE.md's AI-provider abstraction (`parseRecap()`):
clients choose at deploy time whether to use our DIY version, a paid
third-party, or a mix.

```typescript
interface WeatherProvider  { ... }
interface AISProvider      { ... }
interface RouterProvider   { ... }  // already in place
interface AIParseProvider  { ... }  // already in place
```

---

## ✅ Done (shipped to main as of 2026-04-19)

### Ocean routing V2
- Sphere-native Dijkstra over searoute's Oak Ridge maritime network
- GSHHG full-resolution coastline land-mask with coastal-tolerance buffer
- **190 ports** (tanker-relevant, curated from initial 3,700 AIS candidates)
- **14 transit anchors** — trans-Pacific / Indian Ocean / S-Atlantic /
  Arctic shortcut nodes so Dijkstra finds real great-circle crossings
- **4 precomputed passage-avoidance variants**:
  `default` · `no-suez` · `no-panama` · `no-suez-no-panama`
- **Pilot stations** for 111 inland ports (Amsterdam → IJmuiden, etc.)
- **Alias system** (Fos → Lavera, with `matchedAlias` surfaced in UI)
- **Validation**: ~95% match to US PUB 151 reference distances; LB→Yokohama
  4,945 NM vs Netpas 4,853 NM (2% err); 6 outlier pairs tracked in memory

### Fleet map UX
- Leaflet + CARTO dark basemap, OSM/CARTO attribution legal
- **ECA/SECA overlay** — 6 MARPOL Annex VI zones, Netpas-style (filled
  regions + straight regulatory boundary lines)
- **Risk-zone overlay** — Red Sea/Indian Ocean HRA, Black Sea war, Strait
  of Hormuz tension, Gulf of Guinea piracy, Sulu/Celebes piracy
- **Click-to-add port** — cyan clickable reference-port dots when planner
  open, append to waypoint list (dedup)
- **Drag-to-reorder waypoints** — native HTML5 DnD, no extra deps
- **Avoid-passage toggles** in planner (Suez, Panama)
- **Great-circle rendering** of routes (poleward bulge on transatlantic)
- **Compare 2 routes side-by-side** — planner has a "Compare" toggle
  that seeds Route B from A, then an A/B tab picker routes all edits
  to the active one. Map draws both (A cyan, B magenta). Delta panel
  shows B − A in NM, percent, and time. The deviation-cost calc ops
  actually asked for.
- **Click-anywhere waypoint** — click any sea tile → inserts a custom
  `@ 45°N 12°W` waypoint with a dashed-border marker.
- **Runtime Dijkstra over full V2 graph for custom waypoints** —
  when any leg touches a custom `@lat,lon` entry, the API loads the
  full 10,219-node / 17,204-edge land-safe graph and runs per-leg
  Dijkstra with the custom waypoint temporarily wired to its k=5
  nearest graph nodes. Replaces the old straight-great-circle
  haversine fallback that ignored land and the shipping network.
  Perf: graph load ~6 ms (once per container), Dijkstra per leg
  1–4 ms, total added latency ~10 ms. Exported from Python via
  `scripts/ocean-routing/export_graph.py`.
- **Worldscale rate saving** — `worldscale_rates` table keyed on
  (tenant, load_port, discharge_port, year). WorldscalePanel under
  voyage results lists all saved years for the route + inline form
  to add. UPSERT on the unique index so re-saving a year updates
  in place. Historical rows preserved forever.
- **Port costs** — `port_costs` table keyed on (tenant, port, year,
  cost_type). PortCostsButton popover on each waypoint row lists
  saved costs + add form. `cost_type` enum matches DA invoice
  buckets (canal_toll | port_dues | agency | pilotage | other).

---

## 🟢 Next up (no DB needed, quick wins)

*(empty — all items shipped, see Done list above)*

---

## 🟡 Queued (needs DB migration)

*(empty — Worldscale + port costs shipped as of 2026-04-19)*

### Domain reference (kept for future cost-tracking features)

#### Worldscale rates
**Domain context**: Worldscale Association publishes annual "flat
rates" (WS100) — nominal $/MT freight for each named tanker route.
Calculated from distance, port costs, canal fees, bunker prices,
14.5-knot nominal speed, laytime. Charters are quoted as percentages
(WS150 = 150% of flat).

Operators currently look up flat rates from the Worldscale book
(paid subscription PDF). They want a place to type those in once
per (route, year) and stop re-looking-them-up.

**DB**:
```
worldscale_rates
  id | tenant_id | load_port | discharge_port |
  year | flat_rate_usd_mt (decimal) | notes |
  created_by | created_at | updated_at
  UNIQUE(tenant_id, load_port, discharge_port, year)
```

**UX**: under each computed voyage, a "Worldscale flat rates" panel
lists all saved years for that (load, discharge) pair, oldest first.
"+ Add rate for year Y" inline form. Never auto-delete historical
rows — ops needs to see past rates for context.

**Future** (deferred, not in this feature): WS% calculator
(`WS180 × $15.65 = $28.17/MT`) when freight-calc section is added.

### 4. Port costs
**Domain context**: Canal tolls (Suez ~$250k, Panama ~$200k), agency
fees, pilotage, port dues. These vary by port, year, and vessel size.
We don't try to maintain global pricing — operators enter what they
paid / were quoted.

**DB**:
```
port_costs
  id | tenant_id | port | year | cost_type (enum:
    canal_toll | port_dues | agency | pilotage | other) |
  amount_usd (decimal) | notes | created_by | created_at
```

**UX**: click port → dropdown:
```
📍 Rotterdam
  — + Add to planner
  — $ Add port costs
```
Opens a small form with year + cost type + amount.

---

## 🟠 Medium-term (platform migration + visualization)

### 5. MapLibre GL migration (from Leaflet)
**Why**:
- Native 3D globe projection (`globe: true` in v5)
- WebGL performance (needed for AIS real-time rendering at scale)
- Weather particle animations require WebGL
- Custom shaders possible (heat maps, vessel density, etc.)
- Same style spec as Mapbox GL but open-source

**Scope**: rewrite `fleet-map.tsx` primitives —
`CircleMarker`/`Polygon`/`Polyline`/`Tooltip`/`Marker` — as MapLibre
layers. Keep feature parity during migration. Add 2D/3D toggle once
switched.

**Estimate**: 1-2 days focused work.

### 6. 3D globe view
**Why**: wow factor; better spatial intuition for long voyages
(great-circle arcs look like they actually wrap around Earth).

**How**: MapLibre GL v5 `projection: {name: 'globe'}`. Trivial toggle
once 5 is done — same layer code works in both projections.

---

## 🔴 Long-term (big moves — weeks, not days)

### 7. Weather overlay with vessel-forecast animation
**The big idea** (Arne's concept, 2026-04-18):

> Windy shows weather everywhere. Instead, show **weather at every
> vessel's future position**. Slider goes past → future: vessel
> animates along its route, weather updates around it. Storm warning
> highlights when predicted waves exceed threshold.

This is *better* than Windy for maritime ops. We leverage what we
uniquely know: vessel routes + ETAs. Windy doesn't know where your
ships are going.

**Three things that matter in shipping**: wind, wave height (+
direction), temperature. Everything else is noise for ops.

**Architecture** — swappable `WeatherProvider`:

```typescript
interface WeatherProvider {
  getPointForecast(lat, lon, time): Promise<WeatherPoint>;
  getTileUrl(layer: "wind" | "waves" | "temp", time: Date): string | null;
}
```

**Implementations**:

| Provider | Cost | Pros | Cons |
|---|---|---|---|
| `WindyProvider` | $29-99+/mo per deployment | Polished, instant | Licensed, external dep |
| `NoaaProvider` | Free (server CPU only) | On-premise, customizable, ours | 3-5 days build, 70-80% polish |
| `MockProvider` | Free | Tests + demo | Not real |

**NOAA DIY pipeline** (for `NoaaProvider`):
- GFS 0.25° global forecast (free, NOAA, 6h updates, 10-day horizon)
- WaveWatch III global wave model (free, NOAA)
- Backend: cron fetches GRIB2 files, converts to vector tiles + point grids
- Frontend: MapLibre WebGL particle layer for wind, color-gradient for
  wave height, isobars for pressure

**Time slider**:
```
[◄ past] ├──────●──────┤ [future ►]
         |     now
```
- Past: historical weather archive (NOAA stores GFS history) + AIS
  history (see below) → replay actual vessel tracks + actual weather
- Now: current AIS + latest forecast
- Future: predict vessel position from current + speed → query forecast
  at predicted lat/lon/time → animate

**Vessel markers during animation**:
```
[🚢 MT Hafnia Polar]
  +12h — wind 25kn NW · waves 3.5m · 14°C
  ⚠️ STORM AREA at +24h (waves 5.2m forecast)
```

**Estimate**: 1-2 days with Windy API; 3-5 days DIY NOAA. Build both
(same interface), clients pick at deploy.

### 8. Own AIS network (MarineTraffic-class coverage)
**The big idea** (Arne's, 2026-04-18/19):

> Build coastal AIS reception via volunteer receivers — our clients'
> terminal rooftops become the antenna network. For cost of a few
> Raspberry Pis we get our own data source, no more dependence on
> MarineTraffic's $100/user/month pricing.

**Why it works for our use case**:
- Oil tankers transit coastal lanes (Med, ARA, Gulf of Mexico, Hormuz,
  Singapore) where AIS line-of-sight reception is feasible
- Our clients *are* at terminals in ARA (Amsterdam, Rotterdam, Antwerp)
  and Mediterranean (Lavera, Fos, Genoa) — natural receiver sites
- Mid-ocean (where VHF AIS doesn't reach) is <20% of a typical voyage
  by time; satellite AIS add-on if clients want that leg visible

**What's free**:
- ☑️ AIS signal itself (SOLAS-mandated public broadcast)
- ☑️ Decoding software (pyais, AIS-catcher, rtl_ais — all open-source)
- ☑️ **AISHub Data Exchange** — contribute one receiver, receive global
  coastal AIS back (non-commercial use OK; commercial-use terms to
  negotiate)
- ☑️ **NOAA Marine Cadastre** — US historical AIS 2009-2024, 1-min
  resolution, public domain. Great for dev/testing/historical queries.
- ☑️ **EMODnet vessel density** — EU, CC-BY 4.0
- ☑️ **Global Fishing Watch** — fishing vessels globally, open API

**What costs**:
- Receiver hardware: ~€80-120 per site (Pi 4 + dAISy HAT or RTL-SDR +
  VHF antenna)
- Server hosting: ~€50-200/mo (PostgreSQL + PostGIS, ingestion API)
- Satellite AIS (if mid-ocean needed): $$$$ — optional add-on

**Phased roadmap**:

| Phase | What | Time | Cost |
|---|---|---|---|
| 1 | NOAA Marine Cadastre ingestion (historical MVP) | 2-3 days | €0 |
| 2 | Backend: TCP/WebSocket ingest, Postgres+PostGIS, REST API | 1 week | €50/mo server |
| 3 | Fleet map real-time integration | 2-3 days | — |
| 4 | First own receiver at Amsterdam terminal | 1 week (deploy) | €100 hw |
| 5 | AISHub Data Exchange enrollment → global coastal | 1 day | €0 |
| 6 | Receiver-kit + guide for volunteer expansion | 1 week | docs |
| 7 | Historical AIS storage + replay API | 1-2 weeks | storage |
| 8 | Scale: 5-10 receivers across ARA/Med/Gulf | ongoing | €80 × N |

**Architecture** — swappable `AISProvider`:

```typescript
interface AISProvider {
  getCurrentPositions(bbox): Promise<VesselSnapshot[]>;
  getHistory(mmsi, from, to): Promise<Track>;
  subscribe(bbox, onUpdate): Unsubscribe;
}

// Impls:
NefgoNetworkProvider  // our own receivers
AISHubProvider        // data exchange (we contribute → we receive)
NoaaHistoricalProvider // Marine Cadastre, US historical
SpireProvider         // satellite, premium paid tier
MarineTrafficProvider // if client already has license
MockProvider          // tests
```

### 9. Weather-aware fleet replay (integration of 7 + 8)
Once weather + historical AIS both exist, the killer feature:

- Operator opens a past voyage
- Slider goes back in time → vessel position on that day + weather
  conditions it faced
- Answers: "Why did this voyage take 2 extra days?" → "Storm at 48°N
  on day 4, they routed around it"
- Demurrage dispute analytics: actual weather delays documented
- Post-voyage report: auto-generated track + conditions summary

---

## 🔵 Deferred / rejected (captured so we don't revisit)

### Not doing
- **V3 ocean grid densification (~50k nodes)**: 1% accuracy improvement
  doesn't move the needle. Weather affects voyage time 10-100× more
  than graph precision. Only revisit if specific routes show >5% error
  vs real reference data.
- **Port distance matrix page**: no concrete operator use case
- **Port info popup on hover**: Arne wouldn't use it
- **Save/load voyages**: Worldscale-rate saving covers the real
  underlying need (persistent per-route context); voyage plans
  themselves are ephemeral
- **Excel export of distances**: not needed right now
- **More ports (beyond 190) without specific request**: add on demand
  when ops actually needs a specific new port

### Nice to have, not priority
- Keyboard shortcuts in planner (Delete, Enter, arrow-keys reorder)
- Mobile-first Fleet page (currently desktop-only)
- Port search performance for 500+ ports

---

## Session log (what we built & when)

| Date | Session focus | Outcome |
|---|---|---|
| 2026-04-17 | Ocean routing foundation | Sphere graph + GSHHG + pilot stations |
| 2026-04-17 | 190 ports + avoid variants | 4 variants, 100% reachability |
| 2026-04-18 | Map overlays | ECA/SECA + risk zones, multiple iterations |
| 2026-04-18 | Planner UX | Click-to-add, drag-to-reorder, party markers removed |
| 2026-04-18 | Vision session | AIS network + weather forecast + swappable providers plan |

---

## Open questions for Arne

- Which first this week: compare-routes, click-anywhere, or MapLibre
  migration?
- When to start AIS backend work — now (future-proof) or after V1 email
  features?
- Pricing strategy for when we commercialize this beyond NEFGO's own
  needs (per-seat vs per-tenant vs per-receiver-contribution)?
