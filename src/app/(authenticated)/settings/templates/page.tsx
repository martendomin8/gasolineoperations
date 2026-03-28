"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Mail, Pencil, Trash2, ChevronDown, ChevronUp, Eye } from "lucide-react";

interface EmailTemplate {
  id: string;
  name: string;
  partyType: "terminal" | "agent" | "inspector" | "broker";
  incoterm: string | null;
  region: string | null;
  subjectTemplate: string;
  bodyTemplate: string;
  mergeFields: string[];
  version: number;
  createdAt: string;
}

const PARTY_VARIANT: Record<string, string> = {
  terminal:  "info",
  agent:     "accent",
  inspector: "success",
  broker:    "muted",
};

export default function TemplatesPage() {
  const { data: session } = useSession();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const isAdmin = session?.user?.role === "admin";

  useEffect(() => {
    fetch("/api/email-templates")
      .then((r) => r.json())
      .then((d) => { setTemplates(d.templates ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    const res = await fetch(`/api/email-templates/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    }
    setDeleting(null);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Email Templates</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Nomination, instruction, and appointment email templates with merge fields
          </p>
        </div>
        {isAdmin && (
          <Link href="/settings/templates/new">
            <Button variant="primary" size="md">
              <Plus className="h-3.5 w-3.5" />
              New Template
            </Button>
          </Link>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-5 w-5 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Mail className="h-8 w-8 text-[var(--color-text-tertiary)]" />
            <p className="text-sm text-[var(--color-text-secondary)]">No email templates yet</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {templates.map((tmpl) => {
            const isExpanded = expanded === tmpl.id;
            return (
              <Card key={tmpl.id} className="overflow-hidden">
                {/* Header row */}
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-[var(--radius-sm)] bg-[var(--color-surface-3)] flex items-center justify-center flex-shrink-0">
                    <Mail className="h-4 w-4 text-[var(--color-text-secondary)]" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {tmpl.name}
                      </span>
                      <Badge variant={PARTY_VARIANT[tmpl.partyType] as any}>{tmpl.partyType}</Badge>
                      {tmpl.incoterm && <Badge variant="muted">{tmpl.incoterm}</Badge>}
                      {tmpl.region && (
                        <span className="text-xs text-[var(--color-text-tertiary)]">{tmpl.region}</span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 truncate font-mono">
                      {tmpl.subjectTemplate}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {tmpl.mergeFields.length > 0 && (
                      <span className="text-[0.625rem] text-[var(--color-text-tertiary)] mr-1">
                        {tmpl.mergeFields.length} fields
                      </span>
                    )}
                    {isAdmin && (
                      <>
                        <Link href={`/settings/templates/${tmpl.id}/edit`}>
                          <Button variant="ghost" size="sm">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(tmpl.id, tmpl.name)}
                          disabled={deleting === tmpl.id}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-[var(--color-danger)]" />
                        </Button>
                      </>
                    )}
                    <button
                      onClick={() => setExpanded(isExpanded ? null : tmpl.id)}
                      className="p-1.5 rounded text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-3)] transition-colors"
                    >
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Expanded preview */}
                {isExpanded && (
                  <div className="border-t border-[var(--color-border-subtle)] mt-3 pt-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <Eye className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
                      <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                        Template Preview
                      </span>
                      <div className="flex flex-wrap gap-1 ml-2">
                        {tmpl.mergeFields.map((f) => (
                          <span
                            key={f}
                            className="text-[0.625rem] font-mono px-1.5 py-0.5 rounded bg-[var(--color-accent-muted)] text-[var(--color-accent-text)]"
                          >
                            {`{{${f}}}`}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-0)] p-3 space-y-2">
                      <div>
                        <span className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] uppercase tracking-wide">
                          Subject
                        </span>
                        <p className="text-xs font-medium text-[var(--color-text-primary)] mt-0.5">
                          {tmpl.subjectTemplate}
                        </p>
                      </div>
                      <div>
                        <span className="text-[0.625rem] font-mono text-[var(--color-text-tertiary)] uppercase tracking-wide">
                          Body
                        </span>
                        <pre className="text-xs text-[var(--color-text-secondary)] mt-0.5 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                          {tmpl.bodyTemplate}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
