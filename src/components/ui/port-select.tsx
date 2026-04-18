"use client";

/**
 * PortSelect — typeahead port selector backed by PUB 151.
 *
 * Features:
 * - Searches the NGA PUB 151 port database as you type
 * - Shows full canonical names with country (e.g. "Barcelona, Spain")
 * - Detects ambiguous port names (Barcelona → Spain or Venezuela?)
 * - Supports aliases (Lavera → Marseille, France)
 * - Stores canonical name so distance calculator always resolves correctly
 *
 * Ambiguity status (border colour):
 *   Green  — unambiguous, resolved to exactly one port
 *   Red    — ambiguous (multiple candidates) or unknown port
 *   None   — empty / user is still typing
 */

import { cn } from "@/lib/utils/cn";
import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ────────────────────────────────────────────────────

interface PortResult {
  name: string;
  lat: number;
  lon: number;
  /** If this port is an alias, shows which PUB 151 port is used for routing */
  routingVia?: string | null;
}

interface AmbiguityResult {
  query: string;
  isAmbiguous: boolean;
  candidates: PortResult[];
  resolved: string | null;
  isAlias: boolean;
  aliasTarget: string | null;
}

interface PortSelectProps {
  /** Current value — should be a canonical PUB 151 name or empty */
  value: string;
  /** Called with the canonical port name when user selects */
  onChange: (canonicalName: string) => void;
  /** Field label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Error message */
  error?: string;
  /** Required field */
  required?: boolean;
  /** Additional class for the wrapper */
  className?: string;
  /** HTML name attribute (for form submission) */
  name?: string;
  /** Compact mode — smaller padding, no label (for FieldRow in parse page) */
  compact?: boolean;
}

export function PortSelect({
  value,
  onChange,
  label,
  placeholder = "Type port name...",
  error,
  required,
  className,
  name,
  compact = false,
}: PortSelectProps) {
  const [inputValue, setInputValue] = useState(value);
  const [results, setResults] = useState<PortResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [ambiguity, setAmbiguity] = useState<AmbiguityResult | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Sync external value changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Check ambiguity when value changes (not during typing — only on committed values)
  useEffect(() => {
    if (!value) {
      setAmbiguity(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/sea-distance?check=${encodeURIComponent(value)}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() as Promise<AmbiguityResult> : null)
      .then((data) => { if (data) setAmbiguity(data); })
      .catch(() => { /* aborted or failed */ });
    return () => controller.abort();
  }, [value]);

  // Search as user types
  const doSearch = useCallback((query: string) => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    fetch(`/api/sea-distance?search=${encodeURIComponent(query)}`)
      .then((r) => r.ok ? r.json() as Promise<{ ports: PortResult[] }> : { ports: [] })
      .then((data) => {
        setResults(data.ports.slice(0, 10));
        setIsOpen(data.ports.length > 0);
        setHighlightIdx(-1);
      })
      .catch(() => { /* ignore */ });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);

    // Debounce search
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 150);
  };

  const selectPort = (port: PortResult) => {
    setInputValue(port.name);
    onChange(port.name);
    setIsOpen(false);
    setResults([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlightIdx >= 0) {
      e.preventDefault();
      selectPort(results[highlightIdx]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        // If user typed something but didn't select, revert to last committed value
        if (inputValue !== value) {
          setInputValue(value);
        }
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [inputValue, value]);

  // Handle blur — commit if user typed a full canonical name
  const handleBlur = () => {
    // Small delay to allow click on dropdown items
    setTimeout(() => {
      if (!isOpen && inputValue && inputValue !== value) {
        // Check if what they typed matches a known port exactly
        const match = results.find(
          (r) => r.name.toLowerCase() === inputValue.toLowerCase()
        );
        if (match) {
          onChange(match.name);
        }
      }
    }, 200);
  };

  // Determine border colour based on ambiguity
  const getBorderClass = (): string => {
    if (error) return "border-[var(--color-danger)]";
    if (!value) return "border-[var(--color-border-default)]";
    if (!ambiguity) return "border-[var(--color-border-default)]";
    if (ambiguity.isAmbiguous) return "border-[var(--color-danger)]";
    if (ambiguity.candidates.length === 0) return "border-[var(--color-danger)]";
    if (ambiguity.resolved) return "border-[var(--color-success)]";
    return "border-[var(--color-border-default)]";
  };

  // Status hint below the input
  const getHint = (): string | null => {
    if (!value || !ambiguity) return null;
    if (ambiguity.isAmbiguous) {
      return `Ambiguous — ${ambiguity.candidates.length} ports match "${ambiguity.query}". Select the correct one.`;
    }
    if (ambiguity.candidates.length === 0) {
      return `Unknown port "${value}" — not found in database.`;
    }
    if (ambiguity.isAlias && ambiguity.aliasTarget) {
      return `Routing via ${ambiguity.aliasTarget}`;
    }
    return null;
  };

  const hint = getHint();
  const inputId = name || label?.toLowerCase().replace(/\s+/g, "-");

  if (compact) {
    // Compact mode for FieldRow in parse confirmation page
    return (
      <div ref={wrapperRef} className="relative flex-1">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (inputValue.length >= 2) doSearch(inputValue); }}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="w-full text-sm bg-transparent text-[var(--color-text-primary)] border-0 outline-none focus:outline-none font-mono placeholder:text-[var(--color-text-tertiary)]"
        />
        {name && <input type="hidden" name={name} value={value} />}

        {isOpen && results.length > 0 && (
          <Dropdown
            results={results}
            highlightIdx={highlightIdx}
            onSelect={selectPort}
          />
        )}
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className={cn("relative flex flex-col gap-1.5", className)}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-xs font-medium text-[var(--color-text-secondary)] tracking-wide uppercase"
        >
          {label}
          {required && <span className="text-[var(--color-accent)] ml-0.5">*</span>}
        </label>
      )}

      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (inputValue.length >= 2) doSearch(inputValue); }}
        onBlur={handleBlur}
        placeholder={placeholder}
        className={cn(
          "h-9 px-3 text-sm bg-[var(--color-surface-2)] border rounded-[var(--radius-md)] w-full",
          "transition-colors duration-150",
          getBorderClass(),
          "focus:shadow-[0_0_0_3px_var(--color-accent-muted)] focus:border-[var(--color-accent)]"
        )}
      />
      {name && <input type="hidden" name={name} value={value} />}

      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
      {hint && !error && (
        <p className={cn(
          "text-xs",
          ambiguity?.isAmbiguous || ambiguity?.candidates.length === 0
            ? "text-[var(--color-danger)]"
            : "text-[var(--color-text-tertiary)]"
        )}>
          {hint}
        </p>
      )}

      {isOpen && results.length > 0 && (
        <Dropdown
          results={results}
          highlightIdx={highlightIdx}
          onSelect={selectPort}
        />
      )}
    </div>
  );
}

// ── Dropdown ─────────────────────────────────────────────────

function Dropdown({
  results,
  highlightIdx,
  onSelect,
}: {
  results: PortResult[];
  highlightIdx: number;
  onSelect: (port: PortResult) => void;
}) {
  return (
    <div className="absolute z-50 top-full mt-1 w-full bg-[var(--color-surface-2)] border border-[var(--color-border-default)] rounded-[var(--radius-md)] shadow-lg max-h-48 overflow-y-auto">
      {results.map((port, idx) => {
        // Split name into city and country for styling
        const commaIdx = port.name.indexOf(",");
        const city = commaIdx > 0 ? port.name.slice(0, commaIdx) : port.name;
        const country = commaIdx > 0 ? port.name.slice(commaIdx + 1).trim() : "";

        return (
          <button
            key={port.name}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault(); // Prevent blur before click registers
              onSelect(port);
            }}
            className={cn(
              "w-full text-left px-3 py-2 text-sm transition-colors",
              idx === highlightIdx
                ? "bg-[var(--color-accent)] bg-opacity-15 text-[var(--color-text-primary)]"
                : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)]"
            )}
          >
            <div className="flex items-baseline gap-1.5">
              <span className="font-medium">{city}</span>
              {country && (
                <span className="text-[var(--color-text-tertiary)] text-xs">{country}</span>
              )}
            </div>
            {port.routingVia && (
              <p className="text-[0.625rem] text-[var(--color-text-tertiary)] mt-0.5">
                routing via {port.routingVia}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
