"use client";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, type FormEvent } from "react";
import { toast } from "sonner";
import { createDealSchema } from "@/lib/types/deal";
import { z } from "zod";

const directionOptions = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
];

const pricingTypeOptions = [
  { value: "", label: "—" },
  { value: "BL", label: "BL" },
  { value: "NOR", label: "NOR" },
];

const incotermOptions = [
  { value: "FOB", label: "FOB" },
  { value: "CIF", label: "CIF" },
  { value: "CFR", label: "CFR" },
  { value: "DAP", label: "DAP" },
  { value: "FCA", label: "FCA" },
];

export default function NewDealPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [showDupDialog, setShowDupDialog] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([]);

  // Fetch operators for the Secondary Operator select
  useEffect(() => {
    fetch("/api/users?role=operator")
      .then((r) => r.json())
      .then((data) => setOperators(data.users ?? []))
      .catch(() => {});
  }, []);

  function getFormData(form: HTMLFormElement) {
    const fd = new FormData(form);
    return {
      externalRef: fd.get("externalRef") as string || null,
      linkageCode: fd.get("linkageCode") as string || null,
      counterparty: fd.get("counterparty") as string,
      direction: fd.get("direction") as string,
      product: fd.get("product") as string,
      quantityMt: fd.get("quantityMt") as string,
      contractedQty: fd.get("contractedQty") as string || null,
      nominatedQty: fd.get("nominatedQty") ? Number(fd.get("nominatedQty")) : null,
      incoterm: fd.get("incoterm") as string,
      loadport: fd.get("loadport") as string,
      dischargePort: fd.get("dischargePort") as string || null,
      laycanStart: fd.get("laycanStart") as string,
      laycanEnd: fd.get("laycanEnd") as string,
      vesselName: fd.get("vesselName") as string || null,
      vesselImo: fd.get("vesselImo") as string || null,
      pricingFormula: fd.get("pricingFormula") as string || null,
      pricingType: fd.get("pricingType") as string || null,
      pricingEstimatedDate: fd.get("pricingEstimatedDate") as string || null,
      specialInstructions: fd.get("specialInstructions") as string || null,
      secondaryOperatorId: fd.get("secondaryOperatorId") as string || null,
    };
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setLoading(true);

    const data = getFormData(e.currentTarget);

    try {
      const validated = createDealSchema.parse(data);

      // Check duplicates first
      const dupRes = await fetch("/api/deals/check-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterparty: validated.counterparty,
          direction: validated.direction,
          product: validated.product,
          quantityMt: validated.quantityMt,
          laycanStart: validated.laycanStart,
          loadport: validated.loadport,
          dischargePort: validated.dischargePort,
        }),
      });

      if (dupRes.ok) {
        const { duplicates: dups } = await dupRes.json();
        if (dups.length > 0) {
          setDuplicates(dups);
          setPendingData(validated);
          setShowDupDialog(true);
          setLoading(false);
          return;
        }
      }

      await createDeal(validated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        err.issues.forEach((e) => {
          const path = e.path.join(".");
          if (path) fieldErrors[path] = e.message;
        });
        setErrors(fieldErrors);
      }
      setLoading(false);
    }
  }

  async function createDeal(data: any) {
    setLoading(true);
    const res = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || "Failed to create deal");
      setLoading(false);
      return;
    }

    const deal = await res.json();
    toast.success("Deal created");
    router.push(`/deals/${deal.id}`);
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/deals"
          className="p-1.5 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">New Deal</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Enter deal details manually
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Core */}
        <Card>
          <CardHeader>
            <CardTitle>Deal Core</CardTitle>
          </CardHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Counterparty" name="counterparty" required placeholder="e.g. Shell" error={errors.counterparty} />
              <Input label="External Reference" name="externalRef" placeholder="Optional ref number" />
            </div>
            <Input label="Linkage Code" name="linkageCode" placeholder="Optional linkage code" />
            <div className="grid grid-cols-3 gap-4">
              <Select label="Direction" name="direction" options={directionOptions} required error={errors.direction} />
              <Input label="Product" name="product" required placeholder="e.g. EBOB" error={errors.product} />
              <Input label="Quantity (MT)" name="quantityMt" type="number" step="0.001" required placeholder="e.g. 30000" error={errors.quantityMt} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Contracted Qty" name="contractedQty" placeholder="e.g. 37kt +/-10%" />
              <Input label="Nominated Qty" name="nominatedQty" type="number" step="0.001" placeholder="Exact nominated quantity" />
            </div>
            <Select label="Incoterm" name="incoterm" options={incotermOptions} required placeholder="Select incoterm" error={errors.incoterm} />
            <Select
              label="Secondary Operator"
              name="secondaryOperatorId"
              options={[{ value: "", label: "— None —" }, ...operators.map((o) => ({ value: o.id, label: o.name }))]}
              placeholder="Optional secondary operator"
            />
          </div>
        </Card>

        {/* Logistics */}
        <Card>
          <CardHeader>
            <CardTitle>Logistics</CardTitle>
          </CardHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Loadport" name="loadport" required placeholder="e.g. Amsterdam" error={errors.loadport} />
              <Input label="Discharge Port" name="dischargePort" placeholder="e.g. New York" error={errors.dischargePort} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Laycan Start" name="laycanStart" type="date" required error={errors.laycanStart} />
              <Input label="Laycan End" name="laycanEnd" type="date" required error={errors.laycanEnd} />
            </div>
          </div>
        </Card>

        {/* Vessel */}
        <Card>
          <CardHeader>
            <CardTitle>Vessel</CardTitle>
            <Badge variant="muted">Optional</Badge>
          </CardHeader>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Vessel Name" name="vesselName" placeholder="e.g. MT Gannet" />
            <Input label="Vessel IMO" name="vesselImo" placeholder="e.g. 9123456" />
          </div>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Additional</CardTitle>
            <Badge variant="muted">Optional</Badge>
          </CardHeader>
          <div className="space-y-4">
            <Input label="Pricing Formula" name="pricingFormula" placeholder="e.g. Platts CIF NWE -$5/MT" />
            <div className="grid grid-cols-2 gap-4">
              <Select label="Pricing Type" name="pricingType" options={pricingTypeOptions} />
              <Input label="Pricing Estimated Date" name="pricingEstimatedDate" type="date" />
            </div>
            <Textarea label="Special Instructions" name="specialInstructions" placeholder="Any special requirements..." rows={3} />
          </div>
        </Card>

        {/* Submit */}
        <div className="flex gap-3">
          <Button type="submit" loading={loading} size="lg">
            Create Deal
          </Button>
          <Link href="/deals">
            <Button type="button" variant="ghost" size="lg">
              Cancel
            </Button>
          </Link>
        </div>
      </form>

      {/* Duplicate warning dialog */}
      <Dialog
        open={showDupDialog}
        onClose={() => { setShowDupDialog(false); setLoading(false); }}
        title="Potential Duplicate Deals Found"
        description="The following existing deals match your input. Do you still want to create a new deal?"
      >
        <div className="space-y-3 mb-4">
          {duplicates.map((dup) => (
            <div
              key={dup.id}
              className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-warning-muted)] border border-[var(--color-warning)]"
            >
              <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] flex-shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-[var(--color-text-primary)]">{dup.counterparty}</span>
                <span className="text-[var(--color-text-secondary)]">
                  {" "}{dup.direction.toUpperCase()} {dup.product} — {Number(dup.quantityMt).toLocaleString()} MT
                </span>
                <span className="text-xs text-[var(--color-text-tertiary)] ml-2">
                  {dup.laycanStart}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <Button
            variant="primary"
            onClick={() => {
              setShowDupDialog(false);
              createDeal(pendingData);
            }}
          >
            Create Anyway
          </Button>
          <Button
            variant="ghost"
            onClick={() => { setShowDupDialog(false); setLoading(false); }}
          >
            Cancel
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
