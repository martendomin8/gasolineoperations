"use client";

import { cn } from "@/lib/utils/cn";
import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, placeholder, id, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="text-xs font-medium text-[var(--color-text-secondary)] tracking-wide uppercase"
          >
            {label}
            {props.required && <span className="text-[var(--color-accent)] ml-0.5">*</span>}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              "h-9 px-3 pr-8 text-sm bg-[var(--color-surface-2)] border rounded-[var(--radius-md)] w-full appearance-none cursor-pointer",
              "transition-colors duration-150",
              error
                ? "border-[var(--color-danger)]"
                : "border-[var(--color-border-default)] focus:border-[var(--color-accent)]",
              className
            )}
            {...props}
          >
            {placeholder && (
              <option value="" className="text-[var(--color-text-tertiary)]">
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-tertiary)] pointer-events-none" />
        </div>
        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
