import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// GET /api/users — List all users in tenant (operators + admins can read)
export const GET = withAuth(
  async (_req, _ctx, session) => {
    const result = await withTenantDb(session.user.tenantId, async (db) => {
      return db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          isActive: users.isActive,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.tenantId, session.user.tenantId))
        .orderBy(users.name);
    });

    const response = NextResponse.json({ users: result });
    response.headers.set("Cache-Control", "private, max-age=120, stale-while-revalidate=600");
    return response;
  },
  { roles: ["operator", "admin"] }
);

const updateUserSchema = z.object({
  role: z.enum(["operator", "trader", "admin"]).optional(),
  isActive: z.boolean().optional(),
});

// PATCH /api/users?id=... — Update user role or active status (admin only)
export const PATCH = withAuth(
  async (req, _ctx, session) => {
    const url = new URL(req.url);
    const userId = url.searchParams.get("id");
    if (!userId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    // Admin cannot deactivate or demote themselves
    if (userId === session.user.id) {
      return NextResponse.json({ error: "Cannot modify your own account" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const result = await withTenantDb(session.user.tenantId, async (db) => {
      const [updated] = await db
        .update(users)
        .set({ ...updates, updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.tenantId, session.user.tenantId)))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          isActive: users.isActive,
        });
      return updated ?? null;
    });

    if (!result) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json(result);
  },
  { roles: ["admin"] }
);
