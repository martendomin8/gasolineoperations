import { defineConfig } from "drizzle-kit";

// Next.js auto-loads .env.local at server-dev time, but drizzle-kit
// runs as a standalone CLI and doesn't — so we load it manually.
// process.loadEnvFile is built into Node 20.12+; no dotenv dep needed.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local is optional — fall through to system env vars
  // (useful in CI where DATABASE_URL is injected directly).
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
