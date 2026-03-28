"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { createPartySchema } from "@/lib/types/party";
import { z } from "zod";

const typeOptions = [
  { value: "terminal", label: "Terminal" },
  { value: "agent", label: "Agent" },
  { value: "inspector", label: "Inspector" },
  { value: "broker", label: "Broker" },
];

export default function NewPartyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      type: formData.get("type") as string,
      name: formData.get("name") as string,
      port: formData.get("port") as string || null,
      email: formData.get("email") as string || null,
      phone: formData.get("phone") as string || null,
      notes: formData.get("notes") as string || null,
      isFixed: formData.get("isFixed") === "on",
    };

    try {
      const validated = createPartySchema.parse(data);
      const res = await fetch("/api/parties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });

      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Failed to create party");
        setLoading(false);
        return;
      }

      toast.success("Party created");
      router.push("/parties");
    } catch (err) {
      if (err instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        err.issues.forEach((e) => {
          if (e.path[0]) fieldErrors[e.path[0] as string] = e.message;
        });
        setErrors(fieldErrors);
      }
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/parties"
          className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Add Party</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Add a terminal, agent, inspector, or chartering broker
          </p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Type"
              name="type"
              options={typeOptions}
              required
              error={errors.type}
              placeholder="Select type"
            />
            <Input
              label="Name"
              name="name"
              required
              placeholder="e.g. Klaipeda Terminal"
              error={errors.name}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Port"
              name="port"
              placeholder="e.g. Klaipeda"
              error={errors.port}
            />
            <Input
              label="Email"
              name="email"
              type="email"
              placeholder="operations@terminal.com"
              error={errors.email}
            />
          </div>

          <Input
            label="Phone"
            name="phone"
            type="tel"
            placeholder="+370 ..."
            error={errors.phone}
          />

          <Textarea
            label="Notes"
            name="notes"
            placeholder="Operational notes, preferences, contact hours..."
            rows={3}
          />

          <Checkbox
            name="isFixed"
            label="Fixed contact (auto-assigned when port matches)"
          />

          <div className="flex gap-3 pt-2 border-t border-[var(--color-border-subtle)]">
            <Button type="submit" loading={loading}>
              Create Party
            </Button>
            <Link href="/parties">
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
