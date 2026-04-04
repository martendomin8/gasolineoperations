"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText, AlertTriangle, Clock, CheckCircle, Mail, Send, Anchor,
  Hourglass, ArrowRight, Ship, Flame, Timer, Activity, DollarSign,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

interface TaskItem {
  stepId: string;
  stepName: string;
  stepType: string;
  recipientPartyType: string;
  status: string;
  isExternalWait: boolean;
  dealId: string;
  dealRef: string | null;
  counterparty: string;
  product: string;
  incoterm: string;
  loadport: string;
  laycanStart: string;
  workflowInstanceId: string;
}

interface UrgentDeal {
  id: string;
  externalRef: string | null;
  counterparty: string;
  product: string;
  incoterm: string;
  loadport: string;
  dischargePort: string;
  laycanStart: string;
  laycanEnd: string;
  vesselName: string | null;
  status: string;
  direction: string;
  daysUntil: number;
}

interface PricingAlert {
  id: string;
  externalRef: string | null;
  counterparty: string;
  product: string;
  incoterm: string;
  direction: string;
  pricingType: string | null;
  pricingFormula: string | null;
  pricingEstimatedDate: string;
  daysUntil: number;
}

interface DashboardStats {
  activeDeals: number;
  pendingTasks: number;
  waitingExternal: number;
  completedToday: number;
}

const STEP_TYPE_ICON: Record<string, React.ElementType> = {
  nomination:  Anchor,
  instruction: Mail,
  order:       Send,
  appointment: CheckCircle,
};

const RECIPIENT_LABELS: Record<string, string> = {
  terminal:  "Terminal",
  agent:     "Agent",
  inspector: "Inspector",
  broker:    "Broker/Cpty",
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function UrgencyChip({ days }: { days: number }) {
  if (days < 0) return (
    <span className="text-[0.625rem] font-bold px-1.5 py-0.5 rounded bg-[var(--color-danger)] text-white uppercase tracking-wider">In window</span>
  );
  if (days === 0) return (
    <span className="text-[0.625rem] font-bold px-1.5 py-0.5 rounded bg-[var(--color-danger)] text-white uppercase tracking-wider animate-pulse">TODAY</span>
  );
  if (days === 1) return (
    <span className="text-[0.625rem] font-bold px-1.5 py-0.5 rounded bg-[var(--color-danger)] text-white uppercase tracking-wider">Tomorrow</span>
  );
  if (days <= 3) return (
    <span className="text-[0.625rem] font-bold px-1.5 py-0.5 rounded bg-[var(--color-warning,#c8972e)] text-white uppercase tracking-wider">{days}d</span>
  );
  return (
    <span className="text-[0.625rem] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-text-tertiary)] uppercase tracking-wider">{days}d</span>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [urgentDeals, setUrgentDeals] = useState<UrgentDeal[]>([]);
  const [pricingAlerts, setPricingAlerts] = useState<PricingAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const name = session?.user?.name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data) => {
        setTasks(data.tasks ?? []);
        setStats(data.stats ?? null);
        setUrgentDeals(data.urgentDeals ?? []);
        setPricingAlerts(data.pricingAlerts ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const actionable = tasks.filter((t) => t.status === "ready" || t.status === "draft_generated");
  const waiting    = tasks.filter((t) => t.status === "sent" && t.isExternalWait);
  const needsUpdate = tasks.filter((t) => t.status === "needs_update");

  const criticalUrgent = urgentDeals.filter((d) => d.daysUntil <= 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            {greeting}, {name}
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            {loading ? "Loading operations overview…" : (
              actionable.length > 0
                ? `${actionable.length} task${actionable.length !== 1 ? "s" : ""} need your attention`
                : criticalUrgent.length > 0
                ? `${criticalUrgent.length} cargo${criticalUrgent.length !== 1 ? "es" : ""} reaching laycan today or tomorrow`
                : "Operations up to date"
            )}
          </p>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-[var(--radius-md)] bg-[var(--color-info-muted)] flex items-center justify-center flex-shrink-0">
            <Activity className="h-5 w-5 text-[var(--color-info)]" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono tabular-nums">
              {loading ? "—" : (stats?.activeDeals ?? 0)}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wide">Active Cargoes</p>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] flex items-center justify-center flex-shrink-0">
            <Clock className="h-5 w-5 text-[var(--color-accent)]" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono tabular-nums">
              {loading ? "—" : (stats?.pendingTasks ?? 0)}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wide">Pending Tasks</p>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-[var(--radius-md)] bg-[var(--color-surface-3)] flex items-center justify-center flex-shrink-0">
            <Hourglass className="h-5 w-5 text-[var(--color-text-secondary)]" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono tabular-nums">
              {loading ? "—" : (stats?.waitingExternal ?? 0)}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wide">Awaiting Reply</p>
          </div>
        </Card>

        <Card className="flex items-center gap-4">
          <div className={`h-10 w-10 rounded-[var(--radius-md)] flex items-center justify-center flex-shrink-0 ${criticalUrgent.length > 0 ? "bg-[var(--color-danger-muted,#3d1515)]" : "bg-[var(--color-surface-3)]"}`}>
            <Flame className={`h-5 w-5 ${criticalUrgent.length > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-tertiary)]"}`} />
          </div>
          <div>
            <p className={`text-2xl font-bold font-mono tabular-nums ${criticalUrgent.length > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-text-primary)]"}`}>
              {loading ? "—" : criticalUrgent.length}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] uppercase tracking-wide">Laycan Critical</p>
          </div>
        </Card>
      </div>

      {/* Laycan urgency panel */}
      {!loading && urgentDeals.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-[var(--color-accent)]" />
              <CardTitle>Laycan Window — Next 5 Days</CardTitle>
            </div>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {urgentDeals.length} cargo{urgentDeals.length !== 1 ? "es" : ""} approaching
            </span>
          </CardHeader>
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {urgentDeals.map((deal) => (
              <Link
                key={deal.id}
                href={`/deals/${deal.id}`}
                className="flex items-center gap-4 px-1 py-3 hover:bg-[var(--color-surface-2)] rounded-[var(--radius-md)] transition-colors group"
              >
                <div className={`h-8 w-8 rounded-[var(--radius-sm)] flex items-center justify-center flex-shrink-0 ${
                  deal.daysUntil <= 1 ? "bg-[var(--color-danger-muted,#3d1515)]" :
                  deal.daysUntil <= 3 ? "bg-[var(--color-accent-muted)]" :
                  "bg-[var(--color-surface-3)]"
                }`}>
                  <Ship className={`h-4 w-4 ${
                    deal.daysUntil <= 1 ? "text-[var(--color-danger)]" :
                    deal.daysUntil <= 3 ? "text-[var(--color-accent)]" :
                    "text-[var(--color-text-tertiary)]"
                  }`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {deal.counterparty}
                    </span>
                    <Badge variant={deal.direction === "buy" ? "info" : "accent"}>
                      {deal.direction}
                    </Badge>
                    <UrgencyChip days={deal.daysUntil} />
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {deal.product} · {deal.incoterm}
                    </span>
                    <span className="text-xs text-[var(--color-text-tertiary)]">·</span>
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      {deal.loadport} → {deal.dischargePort}
                    </span>
                    {deal.vesselName && (
                      <>
                        <span className="text-xs text-[var(--color-text-tertiary)]">·</span>
                        <span className="text-xs font-mono text-[var(--color-accent-text)]">{deal.vesselName}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-mono text-[var(--color-text-secondary)]">
                    {formatDate(deal.laycanStart)} – {formatDate(deal.laycanEnd)}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 capitalize">{deal.status}</p>
                </div>

                <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Pricing dates approaching */}
      {!loading && pricingAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-[var(--color-accent)]" />
              <CardTitle>Pricing Dates Approaching</CardTitle>
            </div>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {pricingAlerts.length} deal{pricingAlerts.length !== 1 ? "s" : ""} within 3 days
            </span>
          </CardHeader>
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {pricingAlerts.map((alert) => (
              <Link
                key={alert.id}
                href={`/deals/${alert.id}`}
                className="flex items-center gap-4 px-1 py-3 hover:bg-[var(--color-surface-2)] rounded-[var(--radius-md)] transition-colors group"
              >
                <div className={`h-8 w-8 rounded-[var(--radius-sm)] flex items-center justify-center flex-shrink-0 ${
                  alert.daysUntil <= 0 ? "bg-[var(--color-danger-muted,#3d1515)]" :
                  alert.daysUntil <= 1 ? "bg-[var(--color-danger-muted,#3d1515)]" :
                  "bg-[var(--color-accent-muted)]"
                }`}>
                  <DollarSign className={`h-4 w-4 ${
                    alert.daysUntil <= 1 ? "text-[var(--color-danger)]" : "text-[var(--color-accent)]"
                  }`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {alert.counterparty}
                    </span>
                    <Badge variant={alert.direction === "buy" ? "info" : "accent"}>
                      {alert.direction}
                    </Badge>
                    <UrgencyChip days={alert.daysUntil} />
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {alert.pricingType ?? "—"} pricing
                    </span>
                    {alert.pricingFormula && (
                      <>
                        <span className="text-xs text-[var(--color-text-tertiary)]">·</span>
                        <span className="text-xs font-mono text-[var(--color-accent-text)]">{alert.pricingFormula}</span>
                      </>
                    )}
                    <span className="text-xs text-[var(--color-text-tertiary)]">·</span>
                    <span className="text-xs text-[var(--color-text-tertiary)]">
                      {alert.product} {alert.incoterm}
                    </span>
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-mono text-[var(--color-text-secondary)]">
                    {formatDate(alert.pricingEstimatedDate)}
                  </p>
                  {alert.externalRef && (
                    <p className="text-xs font-mono text-[var(--color-text-tertiary)] mt-0.5">{alert.externalRef}</p>
                  )}
                </div>

                <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Re-notification alerts */}
      {!loading && needsUpdate.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[var(--color-danger)]" />
              <CardTitle>Re-notification Required</CardTitle>
            </div>
            <Badge variant="danger">{needsUpdate.length}</Badge>
          </CardHeader>
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {needsUpdate.map((task) => (
              <Link
                key={task.stepId}
                href={`/deals/${task.dealId}`}
                className="flex items-center gap-4 px-1 py-3 hover:bg-[var(--color-surface-2)] rounded-[var(--radius-md)] transition-colors group"
              >
                <div className="h-8 w-8 rounded-[var(--radius-sm)] bg-[var(--color-danger-muted,#3d1515)] flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="h-4 w-4 text-[var(--color-danger)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">{task.stepName}</p>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {task.counterparty} · {task.product} {task.incoterm} · deal field changed
                  </p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Task queue */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[var(--color-text-secondary)]" />
            <CardTitle>Task Queue</CardTitle>
          </div>
          {!loading && actionable.length > 0 && (
            <Badge variant="accent">{actionable.length}</Badge>
          )}
        </CardHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
          </div>
        ) : actionable.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="h-10 w-10 rounded-full bg-[var(--color-surface-3)] flex items-center justify-center mb-3">
              <CheckCircle className="h-5 w-5 text-[var(--color-success)]" />
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">All caught up</p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">No pending tasks right now.</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {actionable.map((task) => {
              const TypeIcon = STEP_TYPE_ICON[task.stepType] ?? Mail;
              const isDraft = task.status === "draft_generated";
              return (
                <Link
                  key={task.stepId}
                  href={`/deals/${task.dealId}`}
                  className="flex items-center gap-4 px-1 py-3 hover:bg-[var(--color-surface-2)] rounded-[var(--radius-md)] transition-colors group cursor-pointer"
                >
                  <div className={`h-8 w-8 rounded-[var(--radius-sm)] flex items-center justify-center flex-shrink-0 ${isDraft ? "bg-[var(--color-accent-muted)]" : "bg-[var(--color-info-muted)]"}`}>
                    <TypeIcon className={`h-4 w-4 ${isDraft ? "text-[var(--color-accent)]" : "text-[var(--color-info)]"}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {task.stepName}
                      </span>
                      <Badge variant={isDraft ? "accent" : "info"}>
                        {isDraft ? "Draft Ready" : "Action Required"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-[var(--color-text-secondary)]">{task.counterparty}</span>
                      <span className="text-xs text-[var(--color-text-tertiary)]">·</span>
                      <span className="text-xs text-[var(--color-text-tertiary)]">{task.product} {task.incoterm}</span>
                      <span className="text-xs text-[var(--color-text-tertiary)]">·</span>
                      <span className="text-xs font-mono text-[var(--color-text-tertiary)]">
                        LC {formatDate(task.laycanStart)}
                      </span>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      → {RECIPIENT_LABELS[task.recipientPartyType] ?? task.recipientPartyType}
                    </p>
                    {task.dealRef && (
                      <p className="text-xs font-mono text-[var(--color-text-tertiary)] mt-0.5">{task.dealRef}</p>
                    )}
                  </div>

                  <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      {/* Waiting for external response */}
      {!loading && waiting.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Hourglass className="h-4 w-4 text-[var(--color-text-tertiary)]" />
              <CardTitle>Awaiting External Response</CardTitle>
            </div>
            <Badge variant="muted">{waiting.length}</Badge>
          </CardHeader>
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {waiting.map((task) => (
              <Link
                key={task.stepId}
                href={`/deals/${task.dealId}`}
                className="flex items-center gap-4 px-1 py-3 hover:bg-[var(--color-surface-2)] rounded-[var(--radius-md)] transition-colors group opacity-75"
              >
                <div className="h-8 w-8 rounded-[var(--radius-sm)] bg-[var(--color-surface-3)] flex items-center justify-center flex-shrink-0">
                  <Hourglass className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-secondary)]">{task.stepName}</p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                    {task.counterparty} · {task.product} · waiting for clearance / doc instructions
                  </p>
                </div>
                {task.dealRef && (
                  <p className="text-xs font-mono text-[var(--color-text-tertiary)] flex-shrink-0">{task.dealRef}</p>
                )}
                <ArrowRight className="h-3.5 w-3.5 text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
