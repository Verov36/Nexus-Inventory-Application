"use client";

import { useEffect, useState } from "react";
import ScannerInput from "@/components/ScannerInput";
import { Wrench, PackageCheck, AlertTriangle, Send, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";

type Part = { id: string; sku: string; name: string; category: string | null; barcodeValue: string };
type TruckOption = { id: string; label: string; active: boolean };

const DEFAULT_WAREHOUSE_ID = process.env.NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID ?? "";
const REMEMBERED_TRUCK_KEY = "nexus-inventory:selected-truck-id";

export default function TruckCheckoutPage() {
  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [truckId, setTruckId] = useState("");
  const [part, setPart] = useState<Part | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [checkoutType, setCheckoutType] = useState<"JOB_USE" | "RESTOCK">("JOB_USE");
  const [jobNumber, setJobNumber] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"neutral" | "error" | "success">("neutral");
  const [needsJustification, setNeedsJustification] = useState<{
    currentTruckQty: number;
    limit: number;
    message: string;
  } | null>(null);
  const [explanation, setExplanation] = useState("");
  const [relatedJobNumbers, setRelatedJobNumbers] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/trucks")
      .then((r) => (r.ok ? r.json() : { trucks: [] }))
      .then((d) => {
        const active: TruckOption[] = (d.trucks ?? []).filter((t: { active: boolean }) => t.active);
        setTrucks(active);
        const remembered = localStorage.getItem(REMEMBERED_TRUCK_KEY);
        if (remembered && active.some((t) => t.id === remembered)) {
          setTruckId(remembered);
        } else if (active.length === 1) {
          setTruckId(active[0].id);
        }
      });
  }, []);

  function handleTruckChange(id: string) {
    setTruckId(id);
    if (id) localStorage.setItem(REMEMBERED_TRUCK_KEY, id);
  }

  async function handleScan(barcode: string) {
    setStatus(null);
    setNeedsJustification(null);
    try {
      const res = await fetch(`/api/parts?barcode=${encodeURIComponent(barcode)}`);
      const data = await res.json();
      if (data.part) {
        setPart(data.part);
      } else {
        setPart(null);
        setStatusTone("error");
        setStatus("No part matches that barcode. Check with the warehouse.");
      }
    } catch {
      setStatusTone("error");
      setStatus("Couldn't look up that barcode — check your connection and try again.");
    }
  }

  async function submitCheckout(withJustification = false) {
    if (!part || !truckId) return;
    setBusy(true);
    setStatus(null);

    const body: Record<string, unknown> = {
      partId: part.id,
      truckId,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      quantity,
      checkoutType,
      jobNumber: checkoutType === "JOB_USE" ? jobNumber : undefined,
    };
    if (withJustification) {
      body.justification = {
        explanation,
        relatedJobNumbers: relatedJobNumbers.split(",").map((s) => s.trim()).filter(Boolean),
      };
    }

    try {
      const res = await fetch("/api/inventory/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setBusy(false);

      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch {
        // Response wasn't JSON (e.g. a raw 500 page) — fall through with an
        // empty object so the generic error message below still fires
        // instead of leaving the tech staring at nothing happening.
      }

      if (res.status === 409) {
        if (data.requiresJustification) {
          setNeedsJustification(
            data as { currentTruckQty: number; limit: number; message: string }
          );
          return;
        }
        setStatusTone("error");
        setStatus(typeof data.error === "string" ? data.error : "Checkout blocked.");
        return;
      }
      if (!res.ok) {
        setStatusTone("error");
        setStatus(
          typeof data.error === "string"
            ? data.error
            : `Checkout failed (${res.status}). Nothing was moved — try again, and tell a manager if it keeps happening.`
        );
        return;
      }

      setStatusTone("success");
      setStatus(`Checked out ${quantity} × ${part.name}.`);
      reset();
    } catch {
      setBusy(false);
      setStatusTone("error");
      setStatus("Couldn't reach the server — check your connection. Nothing was checked out.");
    }
  }

  function reset() {
    setPart(null);
    setQuantity(1);
    setJobNumber("");
    setNeedsJustification(null);
    setExplanation("");
    setRelatedJobNumbers("");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 md:pt-10">
      <PageHeader title="Truck checkout" subtitle="Scan a part to check it out to your truck." />

      <select
        value={truckId}
        onChange={(e) => handleTruckChange(e.target.value)}
        className="tap-target mt-4 w-full rounded-lg border-2 border-nexus-line bg-white px-4 text-sm"
      >
        <option value="">Select your truck…</option>
        {trucks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      {trucks.length === 0 && (
        <p className="mt-2 text-sm text-nexus-steel">
          No active trucks yet — a manager needs to add one at Manage trucks first.
        </p>
      )}

      <div className="mt-4">
        <ScannerInput onScan={handleScan} />
      </div>

      {status && (
        <p
          className={`mt-4 text-sm ${
            statusTone === "error" ? "text-nexus-danger" : statusTone === "success" ? "text-nexus-ok" : "text-nexus-steel"
          }`}
        >
          {status}
        </p>
      )}

      {part && !needsJustification && (
        <Card className="mt-6 p-4">
          <p className="font-data text-xs text-nexus-steel">{part.sku}</p>
          <p className="font-display text-lg font-bold text-nexus-navy">{part.name}</p>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setCheckoutType("JOB_USE")}
              className={`tap-target flex flex-1 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ${
                checkoutType === "JOB_USE" ? "bg-nexus-navy text-white" : "border-2 border-nexus-line text-nexus-navy"
              }`}
            >
              <Wrench size={16} /> For a job
            </button>
            <button
              onClick={() => setCheckoutType("RESTOCK")}
              className={`tap-target flex flex-1 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ${
                checkoutType === "RESTOCK" ? "bg-nexus-navy text-white" : "border-2 border-nexus-line text-nexus-navy"
              }`}
            >
              <PackageCheck size={16} /> Truck restock
            </button>
          </div>

          {checkoutType === "JOB_USE" && (
            <input
              value={jobNumber}
              onChange={(e) => setJobNumber(e.target.value)}
              placeholder="Job / work order number"
              className="tap-target mt-3 w-full rounded-lg border-2 border-nexus-line px-4 font-data"
            />
          )}

          <label className="mt-4 block text-sm text-nexus-steel">Quantity</label>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
            className="tap-target mt-1 w-32 rounded-lg border-2 border-nexus-line px-4 font-data text-lg"
          />

          <Button
            onClick={() => submitCheckout(false)}
            disabled={busy || !truckId || (checkoutType === "JOB_USE" && !jobNumber)}
            className="mt-4 w-full"
          >
            Check out to truck
          </Button>
          {!truckId && <p className="mt-2 text-sm text-nexus-warn">Select your truck above first.</p>}
        </Card>
      )}

      {needsJustification && (
        <Card accent="warn" className="mt-6 p-4">
          <p className="flex items-center gap-2 font-medium text-nexus-warn">
            <AlertTriangle size={18} /> Truck is over its stock cap
          </p>
          <p className="mt-1 text-sm text-nexus-steel">{needsJustification.message}</p>

          <label className="mt-4 block text-sm text-nexus-steel">
            Why is the truck carrying this much? What's it accounted for on?
          </label>
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border-2 border-nexus-line p-3"
          />

          <label className="mt-3 block text-sm text-nexus-steel">
            Related work order numbers (comma separated)
          </label>
          <input
            value={relatedJobNumbers}
            onChange={(e) => setRelatedJobNumbers(e.target.value)}
            className="tap-target mt-1 w-full rounded-lg border-2 border-nexus-line px-4 font-data"
          />

          <div className="mt-4 flex gap-2">
            <Button
              onClick={() => submitCheckout(true)}
              disabled={busy || !explanation || !relatedJobNumbers}
              className="flex-1 !bg-nexus-warn hover:!bg-nexus-warn/90"
              icon={<Send size={16} />}
            >
              Submit and check out
            </Button>
            <Button onClick={reset} variant="secondary" icon={<X size={16} />}>
              Cancel
            </Button>
          </div>
          <p className="mt-2 text-xs text-nexus-steel">
            This checkout goes through now and is flagged for a manager to review.
          </p>
        </Card>
      )}
    </div>
  );
}
