import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";
import { validateEnv } from "../env";

// Lazy initialization — connections created on first use, not at import time.
// This lets the app start and render static/auth pages even without DATABASE_URL.

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _authDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL environment variable is required. " +
      "Set it in .env (copy from .env.example)."
    );
  }
  return url;
}

const isServerless = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
const requiresSsl = isServerless || (process.env.DATABASE_URL?.includes("neon.tech") ?? false);

export function getDb() {
  if (!_db) {
    validateEnv();
    const queryClient = postgres(getConnectionString(), {
      // Serverless (Vercel/Neon): keep pool tiny — each function invocation is short-lived
      max: isServerless ? 3 : 10,
      idle_timeout: isServerless ? 10 : 20,
      connect_timeout: 10,
      // Neon requires SSL in production
      ssl: requiresSsl ? "require" : false,
    });
    _db = drizzle(queryClient, { schema });
  }
  return _db;
}

export function getAuthDb() {
  if (!_authDb) {
    const authUrl = process.env.DATABASE_URL_AUTH || getConnectionString();
    const authClient = postgres(authUrl, {
      max: isServerless ? 2 : 5,
      idle_timeout: isServerless ? 10 : 20,
      ssl: requiresSsl ? "require" : false,
    });
    _authDb = drizzle(authClient, { schema });
  }
  return _authDb;
}

// Convenience aliases (these throw on first access if DATABASE_URL is missing)
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDb() as any)[prop];
  },
});

export const authDb = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getAuthDb() as any)[prop];
  },
});

/**
 * Execute a database operation with tenant-scoped RLS context.
 *
 * Wraps the operation in a transaction that sets `app.current_tenant_id`
 * via SET LOCAL (transaction-scoped, auto-cleaned on commit/rollback).
 * This enables PostgreSQL RLS policies to enforce tenant isolation.
 *
 * IMPORTANT: The application should ALSO filter by tenant_id in queries
 * for index performance. RLS is defense-in-depth, not the only layer.
 */
export async function withTenantDb<T>(
  tenantId: string,
  operation: (tx: ReturnType<typeof getDb>) => Promise<T>
): Promise<T> {
  const database = getDb();
  try {
    return await database.transaction(async (tx) => {
      // SET LOCAL doesn't support parameterized queries ($1) in Postgres.
      // Tenant ID comes from authenticated session (not user input), so
      // string interpolation is safe here. Validate UUID format as defense.
      if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error("Invalid tenant ID format");
      await tx.execute(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
      return await operation(tx as unknown as ReturnType<typeof getDb>);
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[withTenantDb] Tenant ${tenantId} — ${msg}`);
    throw error;
  }
}

export type Database = ReturnType<typeof getDb>;
