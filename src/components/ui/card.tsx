import { cn } from "@/lib/utils/cn";
import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: "none" | "sm" | "md" | "lg";
}

const paddingMap = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export function Card({ children, className, padding = "md", ...props }: CardProps) {
  return (
    <div
      className={cn(
        "bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)]",
        "shadow-[var(--shadow-sm)]",
        paddingMap[padding],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between pb-3 mb-3 border-b border-[var(--color-border-subtle)]", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn("text-sm font-semibold text-[var(--color-text-primary)]", className)}>
      {children}
    </h3>
  );
}
