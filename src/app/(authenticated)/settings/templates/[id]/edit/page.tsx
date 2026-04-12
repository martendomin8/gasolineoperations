"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ArrowLeft, Eye, Code } from "lucide-react";

const MERGE_FIELDS = [
  "counterparty", "direction", "product", "quantity_mt", "incoterm",
  "loadport", "discharge_port", "laycan_start", "laycan_end",
  "vessel_name", "vessel_imo", "external_ref", "pricing_formula",
];

const SAMPLE_DEAL: Record<string, string> = {
  counterparty: "Shell Trading", direction: "sell", product: "EBOB",
  quantity_mt: "30,000", incoterm: "CIF", loadport: "Amsterdam",
  discharge_port: "New York", laycan_start: "2026-04-05", laycan_end: "2026-04-07",
  vessel_name: "MT Gannet Arrow", vessel_imo: "9786543",
  external_ref: "EG-2026-041", pricing_formula: "Platts CIF NWE -$5.00/MT",
};

function previewTemplate(template: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    SAMPLE_DEAL[key] ? `[${SAMPLE_DEAL[key]}]` : `{{${key}}}`
  );
}

export default function EditTemplatePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState({
    name: "", partyType: "terminal", incoterm: "", region: "",
    subjectTemplate: "", bodyTemplate: "",
  });
  const [previewMode, setPreviewMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/email-templates/${id}`)
      .then((r) => r.json())
      .then((t) => {
        setForm({
          name: t.name ?? "",
          partyType: t.partyType ?? "terminal",
          incoterm: t.incoterm ?? "",
          region: t.region ?? "",
          subjectTemplate: t.subjectTemplate ?? "",
          bodyTemplate: t.bodyTemplate ?? "",
        });
        setLoading(false);
      });
  }, [id]);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/email-templates/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        partyType: form.partyType,
        incoterm: form.incoterm || null,
        region: form.region || null,
        subjectTemplate: form.subjectTemplate,
        bodyTemplate: form.bodyTemplate,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) {
      router.push("/settings/templates");
    } else {
      setError(data.error ?? "Failed to save");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-5 w-5 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings/templates" className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Edit Template</h1>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Template Details</CardTitle></CardHeader>
          <div className="space-y-4">
            <Input label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            <Select label="Recipient Type" value={form.partyType} onChange={(e) => set("partyType", e.target.value)}
              options={[{ value: "terminal", label: "Terminal" }, { value: "agent", label: "Agent" }, { value: "inspector", label: "Inspector" }, { value: "broker", label: "Broker / Counterparty" }]} />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Incoterm" value={form.incoterm} onChange={(e) => set("incoterm", e.target.value)}
                options={[{ value: "", label: "Any" }, { value: "FOB", label: "FOB" }, { value: "CIF", label: "CIF" }, { value: "CFR", label: "CFR" }, { value: "DAP", label: "DAP" }]} />
              <Input label="Region" value={form.region} onChange={(e) => set("region", e.target.value)} placeholder="e.g. ARA" />
            </div>
            <Input label="Subject Template" value={form.subjectTemplate} onChange={(e) => set("subjectTemplate", e.target.value)} />
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[0.6875rem] font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">Body Template</label>
                <button onClick={() => setPreviewMode(!previewMode)} className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors">
                  {previewMode ? <Code className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {previewMode ? "Edit" : "Preview"}
                </button>
              </div>
              {previewMode ? (
                <pre className="w-full min-h-48 p-3 text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface-0)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
                  {previewTemplate(form.bodyTemplate) || "(empty)"}
                </pre>
              ) : (
                <textarea value={form.bodyTemplate} onChange={(e) => set("bodyTemplate", e.target.value)}
                  className="w-full min-h-48 p-3 text-xs text-[var(--color-text-primary)] bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] rounded-[var(--radius-md)] outline-none focus:border-[var(--color-border-default)] resize-y font-mono leading-relaxed transition-colors" />
              )}
            </div>
            {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
            <div className="flex gap-2 pt-2">
              <Button variant="primary" onClick={handleSave} disabled={saving} className="flex-1">{saving ? "Saving…" : "Save Changes"}</Button>
              <Link href="/settings/templates"><Button variant="secondary">Cancel</Button></Link>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Merge Fields</CardTitle></CardHeader>
            <div className="grid grid-cols-2 gap-1.5">
              {MERGE_FIELDS.map((f) => (
                <button key={f} onClick={() => set("bodyTemplate", form.bodyTemplate + `{{${f}}}`)}
                  className="text-left px-2.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border-subtle)] transition-colors">
                  <span className="text-xs font-mono text-[var(--color-accent-text)]">{`{{${f}}}`}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader><CardTitle>Live Preview</CardTitle><span className="text-xs text-[var(--color-text-tertiary)]">sample values</span></CardHeader>
            <div className="space-y-2">
              <div>
                <span className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] uppercase tracking-wide">Subject</span>
                <p className="text-xs text-[var(--color-text-primary)] mt-0.5 font-mono">{previewTemplate(form.subjectTemplate) || "—"}</p>
              </div>
              <div>
                <span className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] uppercase tracking-wide">Body</span>
                <pre className="text-xs text-[var(--color-text-secondary)] mt-0.5 whitespace-pre-wrap font-mono leading-relaxed max-h-56 overflow-y-auto">{previewTemplate(form.bodyTemplate) || "—"}</pre>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
