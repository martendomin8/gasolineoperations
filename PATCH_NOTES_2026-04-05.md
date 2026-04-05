# NominationEngine — Patch Notes
## April 5, 2026 · 12 commits

### System Hardening
- **Seed script production guard**: Refuses without `SEED_CONFIRM=yes`. `--structural-only` mode preserves deals.
- **SQL injection prevention**: UUID format validation on tenant ID in SET LOCAL
- **safeParse on all 5 dangerous routes**: check-duplicates, parties GET+POST, deals PUT, documents POST now return 400 not 500
- **Enhanced error wrapper**: ZodError → 400, PostgresError → sanitized 500, logs route path+method
- **Error boundaries**: `error.tsx` for authenticated + root pages with retry button
- **Env validation**: Missing DATABASE_URL or NEXTAUTH_SECRET caught at startup
- **Frontend fetch error toasts**: Dashboard, Excel, Deals pages show toast on API failures

### Performance
- **Neon moved to EU (eu-central-1)**: ~80ms latency reduction per query (Frankfurt↔Frankfurt vs Frankfurt↔Virginia)
- **Cache-Control headers on all GET routes**: stale-while-revalidate for instant repeat navigation
- **AI parser switched to Haiku**: claude-haiku-4-5, ~$0.001 per parse vs $0.01 (10x cheaper)

### Bug Fixes
- **Excel page crash**: `perPage=500` exceeded Zod `max(100)` → changed to `perPage=100` + API returns 400 for invalid filters
- **Dashboard duplicate deals**: Sell side rendered twice due to overlapping render blocks
- **SET LOCAL parameterization**: Reverted — Postgres doesn't support $1 in SET statements
- **Deal list filter**: Completed/cancelled deals now show under "All statuses" in deals list (hidden only from dashboard)

### Infrastructure
- **Anthropic API key configured**: Real AI parsing enabled on both local and Vercel
- **EU Neon database**: Schema pushed, structural data seeded, mock deals cleared
- **Vercel branch deploy control**: Ignored Build Step for non-main branches

### Operator Feedback v2 Received
Arne's 8-section feedback document (`OPERATOR_FEEDBACK_V2.md`) committed to repo. Covers:
1. Pricing periods (BL/NOR/Fixed/EFP) — replace price formula with pricing window
2. Color coding for Excel cells (white → yellow → green states)
3. Exact loaded quantity entry per purchase deal
4. Linkage as its own entity (Linkage table, temp names, merge)
5. Soft warning dependencies (never hard block)
6. Editable Excel dropdowns (operator marks "Done" inline)
7. Two-section Excel: Main table + Internal/Terminal Operations
8. Three-view architecture: Excel overview, Dashboard nav hub, Linkage workspace
