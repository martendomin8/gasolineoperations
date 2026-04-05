"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Fuel, Zap, Shield, Clock, ChevronRight, CheckCircle2 } from "lucide-react";

const FEATURES = [
  { icon: Zap, text: "AI parses trader emails into structured deals in seconds" },
  { icon: Clock, text: "Automated workflow with dependency gates — no missed steps" },
  { icon: CheckCircle2, text: "Change detection flags re-notifications automatically" },
  { icon: Shield, text: "Full audit trail for every communication sent" },
];

export default function DemoPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "provisioning" | "signing-in">("idle");

  const handleLaunchDemo = async () => {
    setLoading(true);
    setError(null);
    setPhase("provisioning");

    try {
      const res = await fetch("/api/demo", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to provision demo");
        setLoading(false);
        setPhase("idle");
        return;
      }

      const { email, password } = await res.json();
      setPhase("signing-in");

      await signIn("credentials", {
        email,
        password,
        redirect: true,
        callbackUrl: "/dashboard",
      });
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
      setPhase("idle");
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-10">
          <div>
            <span className="text-2xl font-extrabold text-white tracking-[-0.04em]">NEFGO<span className="text-[#FFB000]">.</span></span>
          </div>
        </div>

        {/* Headline */}
        <h1 className="text-3xl font-bold text-white mb-3 leading-tight">
          Automate your gasoline trading operations.
          <span className="text-[#FFB000]"> In minutes.</span>
        </h1>
        <p className="text-gray-400 text-sm leading-relaxed mb-8">
          From deal recap email to all nominations sent — NEFGO handles the post-trade workflow
          so your operators focus on exceptions, not copy-paste.
        </p>

        {/* Features */}
        <div className="space-y-3 mb-8">
          {FEATURES.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-[#1a1a24] flex items-center justify-center flex-shrink-0">
                <Icon className="h-3.5 w-3.5 text-[#FFB000]" />
              </div>
              <span className="text-sm text-gray-300">{text}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          onClick={handleLaunchDemo}
          disabled={loading}
          className="w-full h-12 rounded-xl bg-[#FFB000] hover:bg-[#d4a33a] text-white font-semibold text-sm transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-amber-900/20"
        >
          {loading ? (
            <>
              <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              {phase === "provisioning" ? "Setting up your demo…" : "Signing you in…"}
            </>
          ) : (
            <>
              Launch Demo
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </button>

        {error && (
          <p className="mt-3 text-xs text-red-400 text-center">{error}</p>
        )}

        <p className="mt-4 text-center text-xs text-gray-600">
          Instant private demo environment · No signup · Pre-loaded with 5 live cargoes
        </p>
      </div>
    </div>
  );
}
