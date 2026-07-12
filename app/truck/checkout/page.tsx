"use client";

import { useState } from "react";
import ScannerInput from "@/components/ScannerInput";

type Part = { id: string; sku: string; name: string; category: string | null; barcodeValue: string };

const DEFAULT_WAREHOUSE_ID = process.env.NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID ?? "";

export default function TruckCheckoutPage() {
  // TODO: once truck context comes from the signed-in tech's assignment,
  // drop this manual field and read it from session instead.
  const [truckId, setTruckId] = useState("");
  const [part, setPart] = useState<Part | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [checkoutType, setCheckoutType] = useState<"JOB_USE" | "RESTOCK">("JOB_USE");
  const [jobNumber, setJobNumber] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [needsJustification, setNeedsJustification] = useState<{
    currentTruckQty: number;
    limit: number;
    message: string;
  } | null>(null);
  const [explanation, setExplanation] = useState("");
  const [relatedJobNumbers, setRelatedJobNumbers] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleScan(barcode: string) {
    setStatus(null);
    setNeedsJustification(null);
    const res = await fetch(`/api/parts?barcode=${encodeURIComponent(barcode)}`);
    const data = await res.json();
    if (data.part) {
      setPart(data.part);
    } else {
      setPart(null);
      setStatus("No part matches that barcode. Check with the warehouse.");
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

    const res = await fetch("/api/inventory/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);

    if (res.status === 409) {
      const data = await res.json();
      if (data.requiresJustification) {
        setNeedsJustification(data);
        return;
      }
      setStatus(data.error ?? "Checkout blocked.");
      return;
    }
    if (!res.ok) {
      const data = await res.json();
      setStatus("Error: " + JSON.stringify(data.error));
      return;
    }

    setStatus(`Checked out ${quantity} × ${part.name}.`);
    reset();
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
    <main className="mx-auto min-h-screen max-w-2xl bg-nexus-paper px-4 pb-24 pt-8">
      <h1 className="text-2xl font-medium text-nexus-navy">Truck checkout</h1>
      <p className="mt-1 text-nexus-steel">Scan a part to check it out to your truck.</p>

      <input
        value={truckId}
        onChange={(e) => setTruckId(e.target.value)}
        placeholder="Truck id (set once per shift)"
        className="tap-target mt-4 w-full rounded-lg border-2 border-nexus-steel/30 bg-white px-4 text-sm"
      />

      <div className="mt-4">
        <ScannerInput onScan={handleScan} />
      </div>

      {status && <p className="mt-4 text-nexus-steel">{status}</p>}

      {part && !needsJustification && (
        <section className="mt-6 rounded-xl border-2 border-nexus-steel/15 bg-white p-4">
          <p className="text-sm text-nexus-steel">{part.sku}</p>
          <p className="text-lg font-medium text-nexus-navy">{part.name}</p>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setCheckoutType("JOB_USE")}
              className={`tap-target flex-1 rounded-lg font-medium ${
                checkoutType === "JOB_USE" ? "bg-nexus-navy text-white" : "border-2 border-nexus-steel/30 text-nexus-navy"
              }`}
            >
              For a job
            </button>
            <button
              onClick={() => setCheckoutType("RESTOCK")}
              className={`tap-target flex-1 rounded-lg font-medium ${
                checkoutType === "RESTOCK" ? "bg-nexus-navy text-white" : "border-2 border-nexus-steel/30 text-nexus-navy"
              }`}
            >
              Truck restock
            </button>
          </div>

          {checkoutType === "JOB_USE" && (
            <input
              value={jobNumber}
              onChange={(e) => setJobNumber(e.target.value)}
              placeholder="Job / work order number"
              className="tap-target mt-3 w-full rounded-lg border-2 border-nexus-steel/30 px-4"
            />
          )}

          <label className="mt-4 block text-sm text-nexus-steel">Quantity</label>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
            className="tap-target mt-1 w-32 rounded-lg border-2 border-nexus-steel/30 px-4 text-lg"
          />

          <button
            onClick={() => submitCheckout(false)}
            disabled={busy || !truckId || (checkoutType === "JOB_USE" && !jobNumber)}
            className="tap-target mt-4 w-full rounded-lg bg-nexus-ok font-medium text-white disabled:opacity-40"
          >
            Check out to truck
          </button>
        </section>
      )}

      {needsJustification && (
        <section className="mt-6 rounded-xl border-2 border-nexus-warn/50 bg-white p-4">
          <p className="font-medium text-nexus-warn">Truck is over its stock cap</p>
          <p className="mt-1 text-sm text-nexus-steel">{needsJustification.message}</p>

          <label className="mt-4 block text-sm text-nexus-steel">
            Why is the truck carrying this much? What's it accounted for on?
          </label>
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border-2 border-nexus-steel/30 p-3"
          />

          <label className="mt-3 block text-sm text-nexus-steel">
            Related work order numbers (comma separated)
          </label>
          <input
            value={relatedJobNumbers}
            onChange={(e) => setRelatedJobNumbers(e.target.value)}
            className="tap-target mt-1 w-full rounded-lg border-2 border-nexus-steel/30 px-4"
          />

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => submitCheckout(true)}
              disabled={busy || !explanation || !relatedJobNumbers}
              className="tap-target flex-1 rounded-lg bg-nexus-warn font-medium text-white disabled:opacity-40"
            >
              Submit and check out
            </button>
            <button
              onClick={reset}
              className="tap-target rounded-lg border-2 border-nexus-steel/30 px-4 font-medium text-nexus-steel"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-xs text-nexus-steel">
            This checkout goes through now and is flagged for a manager to review.
          </p>
        </section>
      )}
    </main>
  );
}
