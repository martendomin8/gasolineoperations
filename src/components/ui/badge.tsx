import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

type BadgeVariant =
  | "default"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "muted"
  | "draft"
  | "active"
  | "loading"
  | "sailing"
  | "discharging"
  | "completed"
  | "cancelled"
  | "blocked"
  | "ready"
  | "pending"
  | "sent";

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] border-[var(--color-border-default)]",
  accent: "bg-[var(--color-accent-muted)] text-[var(--color-accent-text)] border-[var(--color-accent)]",
  success: "bg-[var(--color-success-muted)] text-[var(--color-success)] border-[var(--color-success)]",
  warning: "bg-[var(--color-warning-muted)] text-[var(--color-warning)] border-[var(--color-warning)]",
  danger: "bg-[var(--color-danger-muted)] text-[var(--color-danger)] border-[var(--color-danger)]",
  info: "bg-[var(--color-info-muted)] text-[var(--color-info)] border-[var(--color-info)]",
  muted: "bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] border-transparent",
  // Deal statuses
  draft: "bg-[#5f677526] text-[var(--color-status-draft)] border-[var(--color-status-draft)]",
  active: "bg-[#3b82f626] text-[var(--color-status-active)] border-[var(--color-status-active)]",
  loading: "bg-[#e5983e26] text-[var(--color-status-loading)] border-[var(--color-status-loading)]",
  sailing: "bg-[#6366f126] text-[var(--color-status-sailing)] border-[var(--color-status-sailing)]",
  discharging: "bg-[#a855f726] text-[var(--color-status-discharging)] border-[var(--color-status-discharging)]",
  completed: "bg-[var(--color-success-muted)] text-[var(--color-status-completed)] border-[var(--color-status-completed)]",
  cancelled: "bg-[var(--color-danger-muted)] text-[var(--color-status-cancelled)] border-[var(--color-status-cancelled)]",
  blocked: "bg-[var(--color-danger-muted)] text-[var(--color-status-blocked)] border-[var(--color-status-blocked)]",
  ready: "bg-[var(--color-success-muted)] text-[var(--color-status-ready)] border-[var(--color-status-ready)]",
  pending: "bg-[#5f677526] text-[var(--color-status-pending)] border-[var(--color-status-pending)]",
  sent: "bg-[#3b82f626] text-[var(--color-status-sent)] border-[var(--color-status-sent)]",
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}

export function Badge({ variant = "default", children, className, dot }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide uppercase rounded-[var(--radius-sm)] border",
        "leading-tight whitespace-nowrap",
        variantStyles[variant],
        className
      )}
    >
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-current flex-shrink-0"
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
