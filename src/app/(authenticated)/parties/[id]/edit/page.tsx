"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

const typeOptions = [
  { value: "terminal", label: "Terminal" },
  { value: "agent", label: "Agent" },
  { value: "inspector", label: "Inspector" },
  { value: "broker", label: "Broker" },
];

export default function EditPartyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [party, setParty] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/parties/${id}`)
      .then((r) => r.json())
      .then((data) => { setParty(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!party) return;
    setSaving(true);

    const fd = new FormData(e.currentTarget);
    const updates = {
      version: party.version,
      type: fd.get("type"),
      name: fd.get("name"),
      port: fd.get("port") || null,
      email: fd.get("email") || null,
      phone: fd.get("phone") || null,
      notes: fd.get("notes") || null,
      isFixed: fd.get("isFixed") === "on",
    };

    const res = await fetch(`/api/parties/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    setSaving(false);

    if (res.status === 409) {
      toast.error("Conflict: this party was modified by another user. Please refresh.");
      return;
    }
    if (!res.ok) {
      toast.error("Failed to update party");
      return;
    }

    toast.success("Party updated");
    router.push("/parties");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!party) return <p className="text-[var(--color-text-secondary)]">Party not found</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/parties"
          className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Edit Party</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{party.name}</p>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Select label="Type" name="type" options={typeOptions} defaultValue={party.type} required />
            <Input label="Name" name="name" required defaultValue={party.name} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Port" name="port" defaultValue={party.port || ""} />
            <Input label="Email" name="email" type="email" defaultValue={party.email || ""} />
          </div>
          <Input label="Phone" name="phone" type="tel" defaultValue={party.phone || ""} />
          <Textarea label="Notes" name="notes" defaultValue={party.notes || ""} rows={3} />
          <Checkbox name="isFixed" label="Fixed contact" defaultChecked={party.isFixed} />

          <div className="flex gap-3 pt-2 border-t border-[var(--color-border-subtle)]">
            <Button type="submit" loading={saving}>Save Changes</Button>
            <Link href="/parties">
              <Button type="button" variant="ghost">Cancel</Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
