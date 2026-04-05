"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Fuel } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, Suspense } from "react";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password");
    } else {
      router.push(callbackUrl);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="operator@company.com"
        required
        autoComplete="email"
        autoFocus
      />

      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Enter password"
        required
        autoComplete="current-password"
        error={error || undefined}
      />

      <Button type="submit" loading={loading} className="w-full mt-2">
        Sign In
      </Button>
    </form>
  );
}

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-0)] relative overflow-hidden">
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(var(--color-accent) 1px, transparent 1px),
            linear-gradient(90deg, var(--color-accent) 1px, transparent 1px)
          `,
          backgroundSize: "64px 64px",
        }}
      />

      {/* Radial glow behind form */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[var(--color-accent)] opacity-[0.03] rounded-full blur-[120px]" />

      {/* Sign in card */}
      <div className="relative z-10 w-full max-w-sm animate-fade-in">
        {/* Logo — NEFGO. wordmark */}
        <div className="flex flex-col items-center mb-8">
          <h1 className="text-4xl font-extrabold text-[var(--color-text-primary)] tracking-[-0.04em]">
            NEFGO<span className="text-[var(--color-accent)]">.</span>
          </h1>
          <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-[0.15em] mt-2">
            Nomination Engine for General Operations
          </p>
        </div>

        {/* Form */}
        <div className="bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] rounded-[var(--radius-xl)] p-6 shadow-[var(--shadow-lg)]">
          <Suspense fallback={<div className="h-32 animate-pulse" />}>
            <SignInForm />
          </Suspense>
        </div>

        {/* Footer */}
        <p className="text-center text-[0.625rem] text-[var(--color-text-tertiary)] mt-6 uppercase tracking-widest">
          Gasoline Trading Operations
        </p>
      </div>
    </div>
  );
}
