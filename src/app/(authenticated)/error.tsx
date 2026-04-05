"use client";
import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <div className="h-12 w-12 rounded-full bg-[var(--color-danger-muted,#3d1515)] flex items-center justify-center">
        <span className="text-2xl">&#9888;</span>
      </div>
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Something went wrong</h2>
      <p className="text-sm text-[var(--color-text-secondary)] max-w-md text-center">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
      >
        Try again
      </button>
    </div>
  );
}
