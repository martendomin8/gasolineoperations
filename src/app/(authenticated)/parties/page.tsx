"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Plus, Search, Building2, User, Microscope, Ship } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { Party, PartyType } from "@/lib/types";

const partyTypeOptions = [
  { value: "", label: "All types" },
  { value: "terminal", label: "Terminal" },
  { value: "agent", label: "Agent" },
  { value: "inspector", label: "Inspector" },
  { value: "broker", label: "Broker" },
];

const typeIcons: Record<PartyType, typeof Building2> = {
  terminal: Building2,
  agent: User,
  inspector: Microscope,
  broker: Ship,
};

const typeBadgeVariant: Record<PartyType, "accent" | "info" | "warning" | "success"> = {
  terminal: "accent",
  agent: "info",
  inspector: "warning",
  broker: "success",
};

export default function PartiesPage() {
  const { data: session } = useSession();
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  useEffect(() => {
    fetchParties();
  }, [search, typeFilter]);

  async function fetchParties() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (typeFilter) params.set("type", typeFilter);

    const res = await fetch(`/api/parties?${params}`);
    if (res.ok) {
      setParties(await res.json());
    }
    setLoading(false);
  }

  const isAdmin = session?.user?.role === "admin";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Parties</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Terminals, agents, inspectors, and chartering brokers
          </p>
        </div>
        {isAdmin && (
          <Link href="/parties/new">
            <Button size="md">
              <Plus className="h-4 w-4" />
              Add Party
            </Button>
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-tertiary)]" />
          <input
            type="text"
            placeholder="Search parties..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9 pr-3 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border-default)] rounded-[var(--radius-md)] w-full focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-muted)] transition-colors"
          />
        </div>
        <Select
          options={partyTypeOptions}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-40"
        />
      </div>

      {/* Table */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)]">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Port</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Phone</th>
                <th className="text-center px-4 py-3">Fixed</th>
              </tr>
            </thead>
            <tbody className="stagger-children">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-sm text-[var(--color-text-tertiary)]">
                    Loading...
                  </td>
                </tr>
              ) : parties.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <p className="text-sm text-[var(--color-text-secondary)]">No parties found</p>
                    <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
                      {isAdmin ? "Add your first terminal, agent, or inspector." : "No parties configured yet."}
                    </p>
                  </td>
                </tr>
              ) : (
                parties.map((party) => {
                  const Icon = typeIcons[party.type as PartyType];
                  return (
                    <tr
                      key={party.id}
                      className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-surface-3)] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/parties/${party.id}/edit`}
                          className="flex items-center gap-2.5 group"
                        >
                          <div className="h-7 w-7 rounded-[var(--radius-sm)] bg-[var(--color-surface-4)] flex items-center justify-center flex-shrink-0">
                            <Icon className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
                          </div>
                          <span className="text-sm font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent-text)] transition-colors">
                            {party.name}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={typeBadgeVariant[party.type as PartyType]}>
                          {party.type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">
                        {party.port || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-secondary)] font-mono text-xs">
                        {party.email || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">
                        {party.phone || "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {party.isFixed && (
                          <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]" title="Fixed contact" />
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
