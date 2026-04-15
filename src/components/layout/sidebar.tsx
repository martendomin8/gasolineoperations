"use client";

import { cn } from "@/lib/utils/cn";
import {
  LayoutDashboard,
  Users,
  Settings,
  Sparkles,
  Mail,
  ChevronLeft,
  Fuel,
  Table2,
  FileText,
  Ship,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Spreadsheet", href: "/excel", icon: Table2 },
  { name: "Parse Email", href: "/deals/parse", icon: Sparkles },
  { name: "Deals", href: "/deals", icon: FileText },
  { name: "Fleet", href: "/fleet", icon: Ship },
  { name: "Parties", href: "/parties", icon: Users },
  { name: "Templates", href: "/settings/templates", icon: Mail },
  { name: "Settings", href: "/settings", icon: Settings },
];

interface SidebarProps {
  userRole: string;
}

export function Sidebar({ userRole }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && href !== "/settings" && pathname.startsWith(href));

  return (
    <aside
      className={cn(
        "flex flex-col h-screen bg-[var(--color-surface-1)] border-r border-[var(--color-border-subtle)]",
        "transition-[width] duration-200 ease-out flex-shrink-0",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-14 border-b border-[var(--color-border-subtle)]">
        {!collapsed ? (
          <div className="flex items-baseline min-w-0">
            <span className="text-lg font-extrabold text-[var(--color-text-primary)] tracking-tight">
              NEFGO
            </span>
            <span className="text-lg font-extrabold text-[var(--color-accent)]">.</span>
          </div>
        ) : (
          <div className="flex items-center justify-center h-8 w-8">
            <span className="text-sm font-extrabold text-[var(--color-text-primary)]">N<span className="text-[var(--color-accent)]">.</span></span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {navigation.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 h-9 rounded-[var(--radius-md)] text-sm font-medium transition-all duration-150",
                active
                  ? "bg-[var(--color-accent-muted)] text-[var(--color-accent-text)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)]",
                collapsed && "justify-center px-0"
              )}
              title={collapsed ? item.name : undefined}
            >
              <item.icon className={cn("h-4 w-4 flex-shrink-0", active && "text-[var(--color-accent)]")} />
              {!collapsed && <span className="truncate">{item.name}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 py-3 border-t border-[var(--color-border-subtle)]">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "flex items-center justify-center w-full h-8 rounded-[var(--radius-md)]",
            "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]",
            "transition-colors cursor-pointer"
          )}
        >
          <ChevronLeft
            className={cn("h-4 w-4 transition-transform duration-200", collapsed && "rotate-180")}
          />
        </button>
      </div>
    </aside>
  );
}
