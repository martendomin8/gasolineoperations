import type { UserRole } from "@/lib/db/schema";

// Augment NextAuth types to include our custom fields
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      tenantId: string;
    };
  }

  interface User {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    tenantId: string;
  }
}

// Re-export schema types for convenience
export type {
  UserRole,
  DealDirection,
  DealIncoterm,
  DealStatus,
  PartyType,
  Deal,
  Party,
  User,
  Tenant,
  AuditLog,
  DealChangeLog,
} from "@/lib/db/schema";
