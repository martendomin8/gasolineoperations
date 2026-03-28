"use client";

import { cn } from "@/lib/utils/cn";
import { Check } from "lucide-react";
import { forwardRef, type InputHTMLAttributes } from "react";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    const checkId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <label
        htmlFor={checkId}
        className={cn("inline-flex items-center gap-2 cursor-pointer group", className)}
      >
        <div className="relative">
          <input
            ref={ref}
            type="checkbox"
            id={checkId}
            className="peer sr-only"
            {...props}
          />
          <div className="h-4 w-4 rounded-[3px] border border-[var(--color-border-default)] bg-[var(--color-surface-2)] transition-all peer-checked:bg-[var(--color-accent)] peer-checked:border-[var(--color-accent)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-accent-muted)]">
            <Check className="h-4 w-4 text-[var(--color-text-inverse)] opacity-0 peer-checked:opacity-100 transition-opacity absolute inset-0" />
          </div>
        </div>
        {label && (
          <span className="text-sm text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors select-none">
            {label}
          </span>
        )}
      </label>
    );
  }
);

Checkbox.displayName = "Checkbox";
