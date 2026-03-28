"use client";

import { SessionProvider } from "next-auth/react";
import { Toaster } from "sonner";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--color-surface-3)",
            border: "1px solid var(--color-border-default)",
            color: "var(--color-text-primary)",
            fontSize: "0.875rem",
          },
        }}
      />
    </SessionProvider>
  );
}
