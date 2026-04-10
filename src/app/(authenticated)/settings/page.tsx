"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users,
  ShieldCheck,
  UserX,
  UserCheck,
  ChevronDown,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: "operator" | "trader" | "admin";
  isActive: boolean;
  createdAt: string;
}

const ROLE_OPTIONS: Array<{ value: UserRecord["role"]; label: string; variant: string }> = [
  { value: "admin",    label: "Admin",    variant: "danger" },
  { value: "operator", label: "Operator", variant: "accent" },
  { value: "trader",   label: "Trader",   variant: "info" },
];

function RoleBadge({ role }: { role: UserRecord["role"] }) {
  const cfg = ROLE_OPTIONS.find((r) => r.value === role) ?? ROLE_OPTIONS[1];
  return <Badge variant={cfg.variant as any}>{cfg.label}</Badge>;
}

function UserRow({
  user,
  currentUserId,
  onUpdate,
}: {
  user: UserRecord;
  currentUserId: string;
  onUpdate: (userId: string, patch: Partial<Pick<UserRecord, "role" | "isActive">>) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const isSelf = user.id === currentUserId;

  const handleRole = async (role: UserRecord["role"]) => {
    if (saving || isSelf) return;
    setSaving(true);
    await onUpdate(user.id, { role });
    setSaving(false);
  };

  const handleToggleActive = async () => {
    if (saving || isSelf) return;
    setSaving(true);
    await onUpdate(user.id, { isActive: !user.isActive });
    setSaving(false);
  };

  return (
    <div
      className={`flex items-center gap-4 py-3 border-b border-[var(--color-border-subtle)] last:border-0 ${
        !user.isActive ? "opacity-50" : ""
      }`}
    >
      {/* Avatar */}
      <div className="h-8 w-8 rounded-full bg-[var(--color-accent-muted)] flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-[var(--color-accent-text)]">
          {user.name.charAt(0).toUpperCase()}
        </span>
      </div>

      {/* Name + email */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">{user.name}</span>
          {isSelf && (
            <span className="text-[0.625rem] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] uppercase tracking-wider">
              You
            </span>
          )}
          {!user.isActive && (
            <span className="text-[0.625rem] font-mono px-1.5 py-0.5 rounded bg-[var(--color-danger-muted,#3d1515)] text-[var(--color-danger)] uppercase tracking-wider">
              Inactive
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--color-text-tertiary)] font-mono truncate">{user.email}</p>
      </div>

      {/* Role selector */}
      <div className="flex-shrink-0">
        {isSelf ? (
          <RoleBadge role={user.role} />
        ) : (
          <div className="relative">
            <select
              value={user.role}
              onChange={(e) => handleRole(e.target.value as UserRecord["role"])}
              disabled={saving || isSelf}
              className="appearance-none text-xs h-7 pl-2.5 pr-6 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-default)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-tertiary)] pointer-events-none" />
          </div>
        )}
      </div>

      {/* Active toggle */}
      {!isSelf && (
        <Button
          variant="secondary"
          size="sm"
          onClick={handleToggleActive}
          disabled={saving}
        >
          {user.isActive ? (
            <><UserX className="h-3 w-3" /> Deactivate</>
          ) : (
            <><UserCheck className="h-3 w-3" /> Activate</>
          )}
        </Button>
      )}
    </div>
  );
}

function CleanSlateCard() {
  const [confirming, setConfirming] = useState(false);
  const [wiping, setWiping] = useState(false);

  const handleWipe = async () => {
    setWiping(true);
    try {
      const res = await fetch("/api/admin/reset-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "WIPE_ALL_DATA" }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("All data wiped", {
          description: `${data.deleted.deals} deals, ${data.deleted.linkages} linkages, ${data.deleted.workflowInstances} workflows cleared.`,
        });
        setConfirming(false);
        // Reload after a short delay so session + dashboard refresh
        setTimeout(() => window.location.href = "/dashboard", 1500);
      } else {
        toast.error(data.error || "Failed to wipe data");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setWiping(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[var(--color-danger)]" />
          <CardTitle>Clean Slate (Testing)</CardTitle>
        </div>
      </CardHeader>
      <div className="space-y-3">
        <p className="text-sm text-[var(--color-text-secondary)]">
          Wipe all deals, linkages, workflow instances, audit logs, email drafts, and documents
          for this tenant. <strong className="text-[var(--color-text-primary)]">Preserves:</strong> users,
          parties, email templates, workflow templates.
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          Use this to start fresh during testing. This action cannot be undone.
        </p>
        {!confirming ? (
          <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
            <Trash2 className="h-3 w-3" />
            Wipe all transactional data
          </Button>
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-[var(--radius-md)] bg-[var(--color-danger-muted,#3d1515)] border border-[var(--color-danger)]">
            <AlertTriangle className="h-4 w-4 text-[var(--color-danger)] flex-shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-medium text-[var(--color-danger)]">
                Are you sure? All deals and linkages will be deleted permanently.
              </p>
            </div>
            <Button variant="danger" size="sm" onClick={handleWipe} disabled={wiping}>
              {wiping ? "Wiping..." : "Yes, wipe everything"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={wiping}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = session?.user?.role === "admin";

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    fetch("/api/users")
      .then((r) => r.json())
      .then((data) => { setUsers(data.users ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [isAdmin]);

  const handleUpdate = async (userId: string, patch: Partial<Pick<UserRecord, "role" | "isActive">>) => {
    const res = await fetch(`/api/users?id=${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated: UserRecord = await res.json();
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...updated } : u)));
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Settings</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Tenant configuration and user management
        </p>
      </div>

      {/* User management — admin only */}
      {isAdmin ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--color-text-tertiary)]" />
              <CardTitle>Users</CardTitle>
            </div>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {users.filter((u) => u.isActive).length} active
            </span>
          </CardHeader>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-5 w-5 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)] py-6 text-center">No users found</p>
          ) : (
            <div>
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  currentUserId={session?.user?.id ?? ""}
                  onUpdate={handleUpdate}
                />
              ))}
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Access Restricted</CardTitle>
          </CardHeader>
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[var(--color-surface-3)] flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-[var(--color-text-tertiary)]" />
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">
              User management is available to administrators only.
            </p>
          </div>
        </Card>
      )}

      {/* Clean slate — admin only, destructive */}
      {isAdmin && <CleanSlateCard />}

      {/* Tenant info (read-only for all) */}
      <Card>
        <CardHeader>
          <CardTitle>Your Account</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <dt className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">Name</dt>
            <dd className="text-sm text-[var(--color-text-primary)] mt-0.5">{session?.user?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">Email</dt>
            <dd className="text-sm text-[var(--color-text-primary)] mt-0.5 font-mono">{session?.user?.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide">Role</dt>
            <dd className="mt-0.5">
              {session?.user?.role && <RoleBadge role={session.user.role as UserRecord["role"]} />}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
