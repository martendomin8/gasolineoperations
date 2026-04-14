"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users,
  UserX,
  UserCheck,
  ChevronDown,
  Trash2,
  AlertTriangle,
  Plus,
  X,
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
  onClick,
}: {
  user: UserRecord;
  currentUserId: string;
  onClick: () => void;
}) {
  const isSelf = user.id === currentUserId;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-center gap-4 py-3 px-2 -mx-2 border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-surface-3)] transition-colors rounded ${
        !user.isActive ? "opacity-50" : ""
      }`}
    >
      <div className="h-8 w-8 rounded-full bg-[var(--color-accent-muted)] flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-[var(--color-accent-text)]">
          {user.name.charAt(0).toUpperCase()}
        </span>
      </div>
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
      <div className="flex-shrink-0">
        <RoleBadge role={user.role} />
      </div>
    </button>
  );
}

function UserDetailModal({
  user,
  currentUserId,
  onClose,
  onUpdate,
  onDelete,
}: {
  user: UserRecord;
  currentUserId: string;
  onClose: () => void;
  onUpdate: (userId: string, patch: Partial<UserRecord> & { password?: string }) => Promise<boolean>;
  onDelete: (userId: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<UserRecord["role"]>(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isSelf = user.id === currentUserId;

  const dirty =
    name.trim() !== user.name ||
    email.trim().toLowerCase() !== user.email ||
    role !== user.role ||
    isActive !== user.isActive ||
    password.length > 0;

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    const patch: Partial<UserRecord> & { password?: string } = {};
    if (name.trim() !== user.name) patch.name = name.trim();
    if (email.trim().toLowerCase() !== user.email) patch.email = email.trim().toLowerCase();
    if (role !== user.role) patch.role = role;
    if (isActive !== user.isActive) patch.isActive = isActive;
    if (password.length >= 8) patch.password = password;
    else if (password.length > 0) {
      toast.error("Password must be at least 8 characters");
      setSaving(false);
      return;
    }
    const ok = await onUpdate(user.id, patch);
    setSaving(false);
    if (ok) onClose();
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    const ok = await onDelete(user.id);
    setDeleting(false);
    if (ok) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-[var(--color-accent-muted)] flex items-center justify-center">
              <span className="text-sm font-bold text-[var(--color-accent-text)]">
                {user.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--color-text-primary)]">Edit user</h2>
              <p className="text-xs text-[var(--color-text-tertiary)] font-mono">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide block mb-1">
              First name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving || deleting}
              className="w-full text-sm h-9 px-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
          </div>

          <div>
            <label className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide block mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={saving || deleting}
              className="w-full text-sm h-9 px-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide block mb-1">
                Role
              </label>
              <div className="relative">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRecord["role"])}
                  disabled={saving || deleting}
                  className="w-full appearance-none text-sm h-9 pl-2.5 pr-7 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] cursor-pointer"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-tertiary)] pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide block mb-1">
                Status
              </label>
              <button
                type="button"
                onClick={() => setIsActive((s) => !s)}
                disabled={saving || deleting}
                className="w-full text-sm h-9 px-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] flex items-center gap-2 justify-center"
              >
                {isActive ? (
                  <><UserCheck className="h-3.5 w-3.5 text-[var(--color-accent-text)]" /> Active</>
                ) : (
                  <><UserX className="h-3.5 w-3.5 text-[var(--color-danger)]" /> Inactive</>
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide block mb-1">
              New password <span className="normal-case text-[var(--color-text-tertiary)]">(leave empty to keep current, min 8 chars)</span>
            </label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={saving || deleting}
              className="w-full text-sm h-9 px-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] font-mono"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-[var(--color-border-subtle)]">
          {!isSelf && (
            confirmDelete ? (
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-[var(--color-danger)] font-medium">Delete permanently?</span>
                <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting..." : "Yes, delete"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)} disabled={saving || deleting}>
                <Trash2 className="h-3 w-3" /> Delete user
              </Button>
            )
          )}
          {isSelf && <span className="text-xs text-[var(--color-text-tertiary)] italic">Can't delete your own account</span>}
          {!confirmDelete && (
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={saving || deleting}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleSave} disabled={!dirty || saving || deleting}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddUserForm({
  onCreate,
  onCancel,
}: {
  onCreate: (payload: { name: string; email: string; role: UserRecord["role"]; password?: string }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRecord["role"]>("operator");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSaving(true);
    const ok = await onCreate({
      name: name.trim(),
      email: email.trim(),
      role,
      password: password.trim() || undefined,
    });
    setSaving(false);
    if (ok) onCancel();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide block mb-1">
            First name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="Lauri"
            className="w-full text-sm h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <div>
          <label className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide block mb-1">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="lauri@nefgo.com"
            className="w-full text-sm h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] font-mono"
          />
        </div>
        <div>
          <label className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide block mb-1">
            Role
          </label>
          <div className="relative">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRecord["role"])}
              className="w-full appearance-none text-sm h-8 pl-2 pr-7 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] cursor-pointer"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--color-text-tertiary)] pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="text-[0.6875rem] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wide block mb-1">
            Password <span className="text-[var(--color-text-tertiary)] normal-case">(optional, min 8)</span>
          </label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="default: password123"
            className="w-full text-sm h-8 px-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] font-mono"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={saving || !name.trim() || !email.trim()}>
          {saving ? "Creating..." : "Create user"}
        </Button>
      </div>
    </form>
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
  const [adding, setAdding] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((data) => { setUsers(data.users ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleUpdate = async (userId: string, patch: Partial<UserRecord> & { password?: string }): Promise<boolean> => {
    const res = await fetch(`/api/users?id=${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated: UserRecord = await res.json();
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...updated } : u)));
      toast.success("User updated");
      return true;
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(typeof data.error === "string" ? data.error : "Failed to update user");
      return false;
    }
  };

  const handleDelete = async (userId: string): Promise<boolean> => {
    const res = await fetch(`/api/users?id=${userId}`, { method: "DELETE" });
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      toast.success("User deleted");
      return true;
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(typeof data.error === "string" ? data.error : "Failed to delete user");
      return false;
    }
  };

  const handleCreate = async (payload: { name: string; email: string; role: UserRecord["role"]; password?: string }): Promise<boolean> => {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const created: UserRecord = await res.json();
      setUsers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success(`User "${created.name}" created`);
      return true;
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(typeof data.error === "string" ? data.error : "Failed to create user");
      return false;
    }
  };

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Settings</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Tenant configuration and user management
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[var(--color-text-tertiary)]" />
            <CardTitle>Users</CardTitle>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {users.filter((u) => u.isActive).length} active
            </span>
            {!adding && (
              <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-3 w-3" /> Add user
              </Button>
            )}
          </div>
        </CardHeader>
        {adding && (
          <div className="mb-3">
            <AddUserForm onCreate={handleCreate} onCancel={() => setAdding(false)} />
          </div>
        )}
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
                onClick={() => setSelectedUserId(user.id)}
              />
            ))}
          </div>
        )}
      </Card>

      <CleanSlateCard />

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

      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          currentUserId={session?.user?.id ?? ""}
          onClose={() => setSelectedUserId(null)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
