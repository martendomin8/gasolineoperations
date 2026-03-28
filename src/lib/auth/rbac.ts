import type { Session } from "next-auth";
import type { UserRole } from "@/lib/db/schema";

export function requireRole(session: Session | null, ...allowedRoles: UserRole[]): void {
  if (!session?.user) {
    throw new AuthError("Unauthorized", 401);
  }
  if (!allowedRoles.includes(session.user.role)) {
    throw new AuthError("Forbidden", 403);
  }
}

export function canEditDeals(session: Session | null): boolean {
  return session?.user?.role === "operator" || session?.user?.role === "admin";
}

export function canManageParties(session: Session | null): boolean {
  return session?.user?.role === "admin";
}

export function canViewDeals(session: Session | null): boolean {
  return !!session?.user;
}

export function canManageTemplates(session: Session | null): boolean {
  return session?.user?.role === "admin";
}

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "AuthError";
  }
}
