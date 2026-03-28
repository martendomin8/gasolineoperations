"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (status === "unauthenticated" && !hasRedirected.current) {
      hasRedirected.current = true;
      router.push("/auth/signin");
    }
  }, [status, router]);

  // Show loading only on initial mount, not on every navigation
  if (status === "loading" && !session) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--color-surface-0)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
          <span className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-widest">
            Loading
          </span>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar userRole={session.user?.role || "operator"} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header
          userName={session.user?.name || "User"}
          userRole={session.user?.role || "operator"}
          tenantName="NominationEngine"
        />
        <main className="flex-1 overflow-y-auto p-6 bg-[var(--color-surface-0)]">
          {children}
        </main>
      </div>
    </div>
  );
}
