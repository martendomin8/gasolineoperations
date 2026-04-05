"use client";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { ArrowLeft, AlertTriangle, Link2, List, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, type FormEvent } from "react";
import { toast } from "sonner";
import { createDealSchema } from "@/lib/types/deal";
import { z } from "zod";

const directionOptions = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
];

const pricingPeriodTypeOptions = [
  { value: "", label: "—" },
  { value: "BL", label: "BL" },
  { value: "NOR", label: "NOR" },
  { value: "Fixed", label: "Fixed" },
  { value: "EFP", label: "EFP" },
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
  const searchParams = useSearchParams();
  const prefillLinkageCode = searchParams.get("linkageCode") ?? "";
  const prefillDirection = searchParams.get("direction") ?? "";
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [showDupDialog, setShowDupDialog] = useState(false);
  const [pendingData, setPendingData] = useState<any>(null);
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([]);
  const [dupChoice, setDupChoice] = useState<"ai" | "manual" | "new">("ai");
  const [manualLinkageCode, setManualLinkageCode] = useState("");
  const [activeLinkageCodes, setActiveLinkageCodes] = useState<string[]>([]);
  const [pricingPeriodType, setPricingPeriodType] = useState("");

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
      pricingPeriodType: fd.get("pricingPeriodType") as string || null,
      pricingPeriodValue: fd.get("pricingPeriodValue") as string || null,
      pricingType: fd.get("pricingPeriodType") as string || null,
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
          setDupChoice("ai");
          setManualLinkageCode("");
          // Fetch active linkage codes for manual selection
          fetch("/api/deals?perPage=200")
            .then((r) => r.json())
            .then((data) => {
              const codes = (data.items ?? [])
                .map((d: any) => d.linkageCode as string | null)
                .filter((c: string | null): c is string => !!c);
              setActiveLinkageCodes([...new Set(codes)] as string[]);
            })
            .catch(() => {});
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
            <Input label="Linkage Code" name="linkageCode" placeholder="Optional linkage code" defaultValue={prefillLinkageCode} />
            <div className="grid grid-cols-3 gap-4">
              <Select label="Direction" name="direction" options={directionOptions} required error={errors.direction} defaultValue={prefillDirection || undefined} />
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
            <div className="grid grid-cols-3 gap-4">
              <Select
                label="Pricing Period Type"
                name="pricingPeriodType"
                options={pricingPeriodTypeOptions}
                onChange={(e) => setPricingPeriodType(e.target.value)}
              />
              <Input label="Pricing Period Value" name="pricingPeriodValue" placeholder="e.g. 0-1-5 or 1-15 Mar" />
              {(pricingPeriodType === "BL" || pricingPeriodType === "NOR") && (
                <Input label="Est. BL/NOR Date" name="pricingEstimatedDate" type="date" />
              )}
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

      {/* Duplicate / linkage dialog */}
      <Dialog
        open={showDupDialog}
        onClose={() => { setShowDupDialog(false); setLoading(false); }}
        title="Potential Duplicate Found"
        description="A matching deal already exists. How would you like to proceed?"
      >
        {/* Matched deal summary */}
        <div className="space-y-2 mb-4">
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
                {dup.linkageCode && (
                  <span className="ml-2 text-xs font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-accent-text)]">
                    {dup.linkageCode}
                  </span>
                )}
                <span className="text-xs text-[var(--color-text-tertiary)] ml-2">
                  {dup.laycanStart}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Three options */}
        <div className="space-y-2 mb-4">
          {/* Option 1: AI suggestion — link to matched deal */}
          {duplicates.length > 0 && duplicates[0].linkageCode && (
            <button
              onClick={() => setDupChoice("ai")}
              className={`w-full flex items-start gap-3 p-3 rounded-[var(--radius-md)] border text-left transition-colors ${
                dupChoice === "ai"
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                  : "border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)]"
              }`}
            >
              <Link2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-[var(--color-accent)]" />
              <div>
                <p className="text-sm font-medium text-[var(--color-text-primary)]">
                  Link to {duplicates[0].counterparty} — {duplicates[0].linkageCode}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                  Set this deal&apos;s linkage code to match the existing deal
                </p>
              </div>
            </button>
          )}

          {/* Option 2: Manual linkage selection */}
          <button
            onClick={() => setDupChoice("manual")}
            className={`w-full flex items-start gap-3 p-3 rounded-[var(--radius-md)] border text-left transition-colors ${
              dupChoice === "manual"
                ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                : "border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)]"
            }`}
          >
            <List className="h-4 w-4 mt-0.5 flex-shrink-0 text-[var(--color-info)]" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Pick linkage manually</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Choose an existing linkage code from active deals
              </p>
              {dupChoice === "manual" && (
                <select
                  value={manualLinkageCode}
                  onChange={(e) => setManualLinkageCode(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-2 w-full h-8 px-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border-default)] rounded-[var(--radius-md)] text-[var(--color-text-primary)]"
                >
                  <option value="">Select a linkage code...</option>
                  {activeLinkageCodes.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              )}
            </div>
          </button>

          {/* Option 3: Create as new */}
          <button
            onClick={() => setDupChoice("new")}
            className={`w-full flex items-start gap-3 p-3 rounded-[var(--radius-md)] border text-left transition-colors ${
              dupChoice === "new"
                ? "border-[var(--color-accent)] bg-[var(--color-accent-muted)]"
                : "border-[var(--color-border-default)] hover:bg-[var(--color-surface-3)]"
            }`}
          >
            <Plus className="h-4 w-4 mt-0.5 flex-shrink-0 text-[var(--color-text-secondary)]" />
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Create as new deal</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                No linkage — this is a standalone deal
              </p>
            </div>
          </button>
        </div>

        <div className="flex gap-3">
          <Button
            variant="primary"
            disabled={dupChoice === "manual" && !manualLinkageCode}
            onClick={() => {
              setShowDupDialog(false);
              let updatedData = { ...pendingData };
              if (dupChoice === "ai" && duplicates[0]?.linkageCode) {
                updatedData.linkageCode = duplicates[0].linkageCode;
              } else if (dupChoice === "manual" && manualLinkageCode) {
                updatedData.linkageCode = manualLinkageCode;
              }
              // "new" leaves linkageCode as-is (from form)
              createDeal(updatedData);
            }}
          >
            {dupChoice === "new" ? "Create Deal" : "Link & Create"}
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
