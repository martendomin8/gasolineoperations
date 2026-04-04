"use client";

import { Badge } from "@/components/ui/badge";
import { LogOut, Bell, Play } from "lucide-react";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";

interface HeaderProps {
  userName: string;
  userRole: string;
  tenantName?: string;
}

export function Header({ userName, userRole, tenantName }: HeaderProps) {
  const roleBadgeVariant = userRole === "admin" ? "accent" : userRole === "trader" ? "info" : "default";
  const [notifCount, setNotifCount] = useState(0);
  const [hasRenotify, setHasRenotify] = useState(false);

  useEffect(() => {
    const fetchCount = () => {
      fetch("/api/notifications")
        .then((r) => r.json())
        .then((data) => {
          setNotifCount(data.total ?? 0);
          setHasRenotify((data.renotify ?? 0) > 0);
        })
        .catch(() => {});
    };

    fetchCount();
    // Poll every 30 seconds
    const interval = setInterval(fetchCount, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="flex items-center justify-between h-14 px-6 bg-[var(--color-surface-1)] border-b border-[var(--color-border-subtle)]">
      {/* Left: tenant name */}
      <div className="flex items-center gap-2">
        {tenantName && (
          <span className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-widest font-medium">
            {tenantName}
          </span>
        )}
      </div>

      {/* Right: notifications, user info, sign out */}
      <div className="flex items-center gap-4">
        {/* Demo tour trigger */}
        <button
          onClick={() => {
            // @ts-expect-error — global wired by DemoTour component
            if (typeof window.__startDemoTour === "function") window.__startDemoTour();
          }}
          title="Start automated 2-minute demo tour"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-md)] text-xs font-medium text-[var(--color-text-tertiary)] border border-dashed border-[var(--color-border-default)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent-text)] hover:bg-[var(--color-accent-muted)] transition-all"
        >
          <Play className="h-3 w-3" />
          Demo
        </button>
        {/* Notification bell */}
        <Link
          href="/dashboard"
          className="relative p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] transition-colors"
          title={notifCount > 0 ? `${notifCount} pending task${notifCount !== 1 ? "s" : ""}` : "No pending tasks"}
        >
          <Bell className={`h-4 w-4 ${notifCount > 0 ? "text-[var(--color-accent)]" : ""}`} />
          {notifCount > 0 && (
            <span
              className={`absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] rounded-full flex items-center justify-center text-[0.5rem] font-bold text-white leading-none px-0.5 ${
                hasRenotify ? "bg-[var(--color-danger)]" : "bg-[var(--color-accent)]"
              }`}
            >
              {notifCount > 99 ? "99+" : notifCount}
            </span>
          )}
        </Link>

        {/* Separator */}
        <div className="h-5 w-px bg-[var(--color-border-default)]" />

        {/* User info */}
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-full bg-[var(--color-surface-4)] flex items-center justify-center text-xs font-bold text-[var(--color-text-secondary)] uppercase">
            {userName.charAt(0)}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-[var(--color-text-primary)] leading-tight">
              {userName}
            </span>
            <Badge variant={roleBadgeVariant} className="mt-0.5 w-fit">
              {userRole}
            </Badge>
          </div>
        </div>

        {/* Sign out */}
        <button
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-muted)] transition-colors cursor-pointer"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
