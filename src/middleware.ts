export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    // Protect all routes except auth, API auth, static files, and Next.js internals
    "/((?!auth|api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
