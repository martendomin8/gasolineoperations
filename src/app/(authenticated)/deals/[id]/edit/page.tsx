"use client";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

const directionOptions = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
];

const incotermOptions = [
  { value: "FOB", label: "FOB" },
  { value: "CIF", label: "CIF" },
  { value: "CFR", label: "CFR" },
  { value: "DAP", label: "DAP" },
  { value: "FCA", label: "FCA" },
];

const pricingPeriodTypeOptions = [
  { value: "", label: "—" },
  { value: "BL", label: "BL" },
  { value: "NOR", label: "NOR" },
  { value: "Fixed", label: "Fixed" },
  { value: "EFP", label: "EFP" },
];

const statusOptions = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "loading", label: "Loading" },
  { value: "sailing", label: "Sailing" },
  { value: "discharging", label: "Discharging" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export default function EditDealPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [deal, setDeal] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([]);
  const [pricingPeriodType, setPricingPeriodType] = useState("");

  useEffect(() => {
    fetch(`/api/deals/${id}`)
      .then((r) => r.json())
      .then((data) => { setDeal(data); setPricingPeriodType(data?.pricingPeriodType || data?.pricingType || ""); setLoading(false); })
      .catch(() => setLoading(false));
    fetch("/api/users?role=operator")
      .then((r) => r.json())
      .then((data) => setOperators(data.users ?? []))
      .catch(() => {});
  }, [id]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!deal) return;
    setSaving(true);

    const fd = new FormData(e.currentTarget);
    const hasLinkage = Boolean(deal.linkageId);
    const updates: Record<string, unknown> = {
      version: deal.version,
      counterparty: fd.get("counterparty"),
      direction: fd.get("direction"),
      product: fd.get("product"),
      quantityMt: fd.get("quantityMt"),
      contractedQty: fd.get("contractedQty") || null,
      nominatedQty: fd.get("nominatedQty") ? Number(fd.get("nominatedQty")) : null,
      incoterm: fd.get("incoterm"),
      linkageCode: fd.get("linkageCode") || null,
      loadport: fd.get("loadport"),
      dischargePort: fd.get("dischargePort") || null,
      laycanStart: fd.get("laycanStart"),
      laycanEnd: fd.get("laycanEnd"),
      vesselCleared: fd.get("vesselCleared") === "on",
      docInstructionsReceived: fd.get("docInstructionsReceived") === "on",
      status: fd.get("status"),
      pricingFormula: fd.get("pricingFormula") || null,
      pricingPeriodType: fd.get("pricingPeriodType") || null,
      pricingPeriodValue: fd.get("pricingPeriodValue") || null,
      pricingType: fd.get("pricingPeriodType") || null,
      pricingEstimatedDate: fd.get("pricingEstimatedDate") || null,
      specialInstructions: fd.get("specialInstructions") || null,
      secondaryOperatorId: fd.get("secondaryOperatorId") || null,
    };
    // Vessel is managed at the linkage level when the deal belongs to a linkage —
    // do not include vesselName/vesselImo in the deal update payload in that case.
    if (!hasLinkage) {
      updates.vesselName = fd.get("vesselName") || null;
      updates.vesselImo = fd.get("vesselImo") || null;
    }

    const res = await fetch(`/api/deals/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    setSaving(false);

    if (res.status === 409) {
      toast.error("Conflict: this deal was modified by another user. Please refresh.");
      return;
    }
    if (res.status === 422) {
      const err = await res.json();
      toast.error(err.error || "Invalid status transition");
      return;
    }
    if (!res.ok) {
      toast.error("Failed to update deal");
      return;
    }

    toast.success("Deal updated");
    router.push(`/deals/${id}`);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!deal) return <p className="text-[var(--color-text-secondary)]">Deal not found</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/deals/${id}`}
          className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Edit Deal</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            {deal.counterparty} — {deal.product}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Core Details</CardTitle>
            <Badge variant={deal.status} dot>{deal.status}</Badge>
          </CardHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Counterparty" name="counterparty" required defaultValue={deal.counterparty} />
              <Select label="Status" name="status" options={statusOptions} defaultValue={deal.status} />
            </div>
            <Input label="Linkage Code" name="linkageCode" defaultValue={deal.linkageCode || ""} placeholder="Optional linkage code" />
            <div className="grid grid-cols-3 gap-4">
              <Select label="Direction" name="direction" options={directionOptions} defaultValue={deal.direction} />
              <Input label="Product" name="product" required defaultValue={deal.product} />
              <Input label="Quantity (MT)" name="quantityMt" type="number" step="0.001" required defaultValue={deal.quantityMt} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Contracted Qty" name="contractedQty" defaultValue={deal.contractedQty || ""} placeholder="e.g. 37kt +/-10%" />
              <Input label="Nominated Qty" name="nominatedQty" type="number" step="0.001" defaultValue={deal.nominatedQty || ""} placeholder="Exact nominated quantity" />
            </div>
            <Select label="Incoterm" name="incoterm" options={incotermOptions} defaultValue={deal.incoterm} />
            <Select
              label="Secondary Operator"
              name="secondaryOperatorId"
              options={[{ value: "", label: "— None —" }, ...operators.map((o) => ({ value: o.id, label: o.name }))]}
              defaultValue={deal.secondaryOperatorId || ""}
            />
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>Logistics</CardTitle></CardHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Loadport" name="loadport" required defaultValue={deal.loadport} />
              <Input label="Discharge Port" name="dischargePort" defaultValue={deal.dischargePort || ""} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Laycan Start" name="laycanStart" type="date" required defaultValue={deal.laycanStart} />
              <Input label="Laycan End" name="laycanEnd" type="date" required defaultValue={deal.laycanEnd} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>Vessel</CardTitle></CardHeader>
          <div className="space-y-4">
            {deal.linkageId ? (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-2)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
                Vessel is managed at the linkage level.{" "}
                <Link
                  href={`/deals/${id}`}
                  className="text-[var(--color-accent)] hover:underline font-medium"
                >
                  Open the linkage view
                </Link>{" "}
                to change the vessel. All deals in this linkage share the same vessel.
                {(deal.vesselName || deal.vesselImo) && (
                  <div className="mt-2 text-xs text-[var(--color-text-tertiary)]">
                    Current: <span className="text-[var(--color-text-primary)] font-medium">{deal.vesselName || "—"}</span>
                    {deal.vesselImo && (
                      <span className="font-mono ml-2">IMO {deal.vesselImo}</span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Input label="Vessel Name" name="vesselName" defaultValue={deal.vesselName || ""} />
                <Input label="Vessel IMO" name="vesselImo" defaultValue={deal.vesselImo || ""} />
              </div>
            )}
            <div className="flex gap-6">
              <Checkbox label="Vessel Cleared" name="vesselCleared" defaultChecked={deal.vesselCleared} />
              <Checkbox label="Documentary Instructions Received" name="docInstructionsReceived" defaultChecked={deal.docInstructionsReceived} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader><CardTitle>Additional</CardTitle></CardHeader>
          <div className="space-y-4">
            <Input label="Pricing Formula" name="pricingFormula" defaultValue={deal.pricingFormula || ""} />
            <div className="grid grid-cols-3 gap-4">
              <Select
                label="Pricing Period Type"
                name="pricingPeriodType"
                options={pricingPeriodTypeOptions}
                defaultValue={deal.pricingPeriodType || deal.pricingType || ""}
                onChange={(e) => setPricingPeriodType(e.target.value)}
              />
              <Input label="Pricing Period Value" name="pricingPeriodValue" defaultValue={deal.pricingPeriodValue || ""} placeholder="e.g. 0-1-5 or 1-15 Mar" />
              {(pricingPeriodType === "BL" || pricingPeriodType === "NOR") && (
                <Input label="Est. BL/NOR Date" name="pricingEstimatedDate" type="date" defaultValue={deal.pricingEstimatedDate || ""} />
              )}
            </div>
            <Textarea label="Special Instructions" name="specialInstructions" defaultValue={deal.specialInstructions || ""} rows={3} />
          </div>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" loading={saving} size="lg">Save Changes</Button>
          <Link href={`/deals/${id}`}>
            <Button type="button" variant="ghost" size="lg">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
