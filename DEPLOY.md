# NominationEngine — Deployment Guide

## Stack
- **Frontend/Backend**: Next.js 16 on Vercel (fra1 region)
- **Database**: Neon PostgreSQL (serverless)
- **Email**: Resend
- **Auth**: Auth.js v5

---

## Step 1 — Create GitHub Repo

```bash
# Create repo on GitHub (github.com/new), then:
git remote add origin https://github.com/YOUR_ORG/nominationengine.git
git push -u origin master
```

---

## Step 2 — Set Up Neon Database

1. Go to [neon.tech](https://neon.tech) → New Project → Region: **eu-central-1** (Frankfurt)
2. Copy the **pooled** connection string (for app queries)
3. Copy the **direct** (non-pooled) connection string (for auth + migrations)

Both strings look like:
```
postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/nominationengine?sslmode=require
```

---

## Step 3 — Push Schema to Neon

Set the direct connection string temporarily:

```bash
DATABASE_URL="postgresql://..." npm run db:push
```

This creates all tables, enums, and indexes. No migrations needed — Drizzle pushes the schema directly.

---

## Step 4 — Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) → Import from GitHub
2. Framework: **Next.js** (auto-detected)
3. Add these **Environment Variables**:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Neon **pooled** connection string |
| `DATABASE_URL_AUTH` | Neon **direct** connection string |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `RESEND_API_KEY` | From resend.com |
| `EMAIL_FROM` | `NomEngine <noreply@yourdomain.com>` |
| `DEMO_ENABLED` | `true` |

4. Click **Deploy**

---

## Step 5 — Seed Demo Data (optional)

After deploy, the `/demo` page auto-provisions isolated demo tenants on demand.

To seed a persistent tenant for your own use:
```bash
DATABASE_URL="postgresql://..." npm run db:seed
```

---

## Step 6 — Verify

| URL | What to check |
|-----|---------------|
| `/demo` | Launch Demo button → signs in, shows dashboard |
| `/dashboard` | Task queue loads, bell badge shows counts |
| `/deals` | Deal list renders |
| `/deals/[id]` | Workflow steps, generate draft, mark sent |

---

## Domain Setup (optional)

In Vercel → Settings → Domains → Add your domain.
Update `NEXTAUTH_URL` env var to match.

---

## Troubleshooting

**"Database URL is required"** — `DATABASE_URL` env var missing in Vercel.

**Auth 500 error** — `NEXTAUTH_SECRET` missing or `NEXTAUTH_URL` doesn't match deployed URL.

**Email not sending** — Check `RESEND_API_KEY` is set. Without it, emails log to console (demo mode).

**Demo page 403** — Set `DEMO_ENABLED=true` in Vercel environment variables.
