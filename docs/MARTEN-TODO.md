# Tasks for Marten (or Marten's Claude Code)

Rolling list of production issues or setup tasks that need Marten's
access to fix. When Arne flags something he can't resolve from his
local machine, a section goes here with the symptom, likely root
causes in priority order, and files to investigate.

**Weather overlay v1 production setup**: see
[`MARTEN-HANDOFF.md`](./MARTEN-HANDOFF.md). That's a separate,
focused doc — follow it end-to-end rather than piecing through this
file for weather stuff.

---

## 1. Q88 parsing fails on main / production

**Symptom**: The Q88 vessel-questionnaire drag-and-drop flow works
on Arne's local machine (`npm run dev` against his local env) but
fails with an error on the `main`-branch-deployed production site.
Arne doesn't have the exact error message to hand — first step is
to capture it.

### Most likely root cause

**Missing `ANTHROPIC_API_KEY` in Vercel production env vars.** The
Q88 parser uses the same AI provider abstraction as the email deal
parser (see `CLAUDE.md` → "AI deal parsing" + `src/lib/ai/parse-q88.ts`).
If Arne's local `.env` has the API key but the Vercel project's
Production environment doesn't, any parse attempt throws an auth
error.

**Where to check**: Vercel dashboard → NEFGO project → Settings →
Environment Variables. Should have `ANTHROPIC_API_KEY` set for the
Production scope. Same variable probably also needed in Preview if
branch deploys are expected to parse.

### Other possibilities (in decreasing order of likelihood)

2. **Request body size limit.** Q88 files are typically 5–20 MB
   PDFs. Vercel serverless functions default to a 4.5 MB request
   body limit; if the upload exceeds that, the call 413s before
   reaching the parser. Check whether the upload route uses
   chunked/streaming upload or a bigger-body config. Files:
   `src/app/api/linkages/[id]/documents/route.ts`,
   `src/app/api/documents/route.ts`.

3. **PDF extraction binary missing.** If the parser shells out to
   Poppler or similar to extract text from PDF Q88s, Vercel
   serverless doesn't have native binaries. If it's pure JS
   (e.g. `pdfjs`), rule out.

4. **Stricter auth on prod.** Production might enforce role checks
   the local dev bypasses. Files: `src/app/api/linkages/[id]/documents/[docId]/parse-q88/route.ts`,
   auth middleware.

### First concrete step for Marten's Claude Code

Reproduce the failure in prod, grab the browser DevTools **Network
tab** response body (likely JSON with an `error` field) and the
Vercel function logs (Vercel dashboard → the NEFGO project →
Logs → filter for `/api/linkages/*/documents/*/parse-q88`). The
error message will map to one of the four causes above in under a
minute.

### Files to look at

| File | What |
|---|---|
| `src/lib/ai/parse-q88.ts` | AI parser — calls the provider |
| `src/app/api/linkages/[id]/documents/[docId]/parse-q88/route.ts` | API endpoint that gets hit |
| `src/app/api/linkages/[id]/documents/route.ts` | Upload endpoint (size limits) |
| `src/app/api/documents/route.ts` | General document handling |
| `.env.example` | Compare against Vercel env var list |

---

## How to add to this list

When a new "works local, breaks prod" issue is discovered, append a
section above with:

1. **Symptom** — one sentence, honest
2. **Most likely root cause** — a ranked guess with files to check
3. **Other possibilities** — 2–4 ranked by likelihood
4. **First step for whoever picks it up** — concrete, 1–2 actions

Keep it short. "I don't know the error" beats speculation about
errors that aren't there.
