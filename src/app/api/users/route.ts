import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { withTenantDb } from "@/lib/db";
import { users, deals, linkages } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";

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
    response.headers.set("Cache-Control", "no-store");
    return response;
  },
  { roles: ["operator", "admin", "trader"] }
);

const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email().max(255).optional(),
  role: z.enum(["operator", "trader", "admin"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(255).optional(),
});

// PATCH /api/users?id=... — Update user name/email/role/active status
// V1: any authenticated user can edit anyone (no role gate, no self-edit guard)
export const PATCH = withAuth(
  async (req, _ctx, session) => {
    const url = new URL(req.url);
    const userId = url.searchParams.get("id");
    if (!userId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const body = await req.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { password, ...rest } = parsed.data;
    const updates: Record<string, unknown> = { ...rest };
    if (typeof updates.email === "string") updates.email = updates.email.toLowerCase();
    if (password) updates.passwordHash = await bcrypt.hash(password, 10);

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
  { roles: ["operator", "admin", "trader"] }
);

// DELETE /api/users?id=... — Permanently remove a user
// V1: any authenticated user can delete; refuses self-delete to avoid locking yourself out
export const DELETE = withAuth(
  async (req, _ctx, session) => {
    const url = new URL(req.url);
    const userId = url.searchParams.get("id");
    if (!userId) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    if (userId === session.user.id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 403 });
    }

    try {
      const result = await withTenantDb(session.user.tenantId, async (db) => {
        // Null out nullable FK references so the delete doesn't fail on them.
        // createdBy is NOT NULL, so if the user created deals, the delete below
        // will throw — we surface that as a friendly error.
        await db.update(linkages)
          .set({ assignedOperatorId: null })
          .where(and(eq(linkages.assignedOperatorId, userId), eq(linkages.tenantId, session.user.tenantId)));
        await db.update(linkages)
          .set({ secondaryOperatorId: null })
          .where(and(eq(linkages.secondaryOperatorId, userId), eq(linkages.tenantId, session.user.tenantId)));
        await db.update(deals)
          .set({ assignedOperatorId: null })
          .where(and(eq(deals.assignedOperatorId, userId), eq(deals.tenantId, session.user.tenantId)));
        await db.update(deals)
          .set({ secondaryOperatorId: null })
          .where(and(eq(deals.secondaryOperatorId, userId), eq(deals.tenantId, session.user.tenantId)));

        const [deleted] = await db
          .delete(users)
          .where(and(eq(users.id, userId), eq(users.tenantId, session.user.tenantId)))
          .returning({ id: users.id });
        return deleted ?? null;
      });

      if (!result) return NextResponse.json({ error: "User not found" }, { status: 404 });
      return NextResponse.json({ id: result.id, deleted: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("foreign key") || message.includes("violates foreign key constraint")) {
        return NextResponse.json(
          { error: "This user is referenced by historical records (e.g. deals they created). Deactivate them instead." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
    }
  },
  { roles: ["operator", "admin", "trader"] }
);

const createUserSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  role: z.enum(["operator", "trader", "admin"]),
  password: z.string().min(8).max(255).optional(),
});

// POST /api/users — Create a new user in the current tenant
// V1: any authenticated user can create users (no role gate)
export const POST = withAuth(
  async (req, _ctx, session) => {
    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { name, email, role, password } = parsed.data;
    const effectivePassword = password ?? "password123";
    const passwordHash = await bcrypt.hash(effectivePassword, 10);

    try {
      const result = await withTenantDb(session.user.tenantId, async (db) => {
        const [created] = await db
          .insert(users)
          .values({
            tenantId: session.user.tenantId,
            name,
            email: email.toLowerCase(),
            passwordHash,
            role,
            isActive: true,
          })
          .returning({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
            isActive: users.isActive,
            createdAt: users.createdAt,
          });
        return created;
      });

      return NextResponse.json(result, { status: 201 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("users_tenant_email_idx") || message.includes("duplicate")) {
        return NextResponse.json({ error: "Email already exists in this tenant" }, { status: 409 });
      }
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }
  },
  { roles: ["operator", "admin", "trader"] }
);
