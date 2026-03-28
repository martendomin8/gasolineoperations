import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import type { Session } from "next-auth";
import type { UserRole } from "@/lib/db/schema";

type RouteContext = { params: Promise<Record<string, string>> };

type AuthenticatedHandler = (
  req: NextRequest,
  context: RouteContext,
  session: Session
) => Promise<NextResponse>;

interface WithAuthOptions {
  roles?: UserRole[];
}

/**
 * Higher-order function wrapping Next.js API route handlers with auth.
 * Single chokepoint for authentication and authorization.
 *
 * Usage:
 *   export const GET = withAuth(async (req, ctx, session) => { ... });
 *   export const POST = withAuth(async (req, ctx, session) => { ... }, { roles: ["admin"] });
 */
export function withAuth(handler: AuthenticatedHandler, options?: WithAuthOptions) {
  return async (req: NextRequest, context: RouteContext): Promise<NextResponse> => {
    try {
      const session = await auth();

      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (options?.roles && !options.roles.includes(session.user.role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      return await handler(req, context, session);
    } catch (error) {
      if (error instanceof Error && error.name === "AuthError") {
        const statusCode = (error as any).statusCode || 401;
        return NextResponse.json({ error: error.message }, { status: statusCode });
      }
      console.error("API Error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
