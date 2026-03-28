"use client";

import { cn } from "@/lib/utils/cn";
import { forwardRef, type TextareaHTMLAttributes } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={textareaId}
            className="text-xs font-medium text-[var(--color-text-secondary)] tracking-wide uppercase"
          >
            {label}
            {props.required && <span className="text-[var(--color-accent)] ml-0.5">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            "px-3 py-2 text-sm bg-[var(--color-surface-2)] border rounded-[var(--radius-md)] w-full min-h-[80px] resize-y",
            "transition-colors duration-150",
            error
              ? "border-[var(--color-danger)]"
              : "border-[var(--color-border-default)] focus:border-[var(--color-accent)]",
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";
