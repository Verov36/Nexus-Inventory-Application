"use client";

import { useState } from "react";
import ScannerInput from "@/components/ScannerInput";
import { printLabel } from "@/lib/zebra-print";

type Part = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  barcodeValue: string;
};

type ReceivedEntry = {
  part: Part;
  quantity: number;
  at: string;
};

// TODO: replace with the signed-in org's actual warehouse id once
// multi-warehouse support / org context is wired in.
const DEFAULT_WAREHOUSE_ID = process.env.NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID ?? "";

export default function ReceivingPage() {
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [matchedPart, setMatchedPart] = useState<Part | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "not_found">("idle");
  const [quantity, setQuantity] = useState(1);
  const [newPart, setNewPart] = useState({ sku: "", name: "", category: "" });
  const [log, setLog] = useState<ReceivedEntry[]>([]);
  const [printStatus, setPrintStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleScan(barcode: string) {
    setScannedBarcode(barcode);
    setLookupState("loading");
    setPrintStatus(null);
    const res = await fetch(`/api/parts?barcode=${encodeURIComponent(barcode)}`);
    const data = await res.json();
    if (data.part) {
      setMatchedPart(data.part);
      setLookupState("idle");
    } else {
      setMatchedPart(null);
      setLookupState("not_found");
      setNewPart({ sku: "", name: "", category: "" });
    }
  }

  async function createPartFromScan() {
    if (!scannedBarcode) return;
    setBusy(true);
    const res = await fetch("/api/parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: newPart.sku,
        name: newPart.name,
        category: newPart.category || undefined,
        barcodeValue: scannedBarcode,
      }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setMatchedPart(data.part);
      setLookupState("idle");
    } else {
      const err = await res.json();
      alert("Couldn't create part: " + JSON.stringify(err.error));
    }
  }

  async function receivePart() {
    if (!matchedPart || !DEFAULT_WAREHOUSE_ID) {
      if (!DEFAULT_WAREHOUSE_ID) alert("No warehouse configured — set NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/inventory/receive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partId: matchedPart.id,
        warehouseId: DEFAULT_WAREHOUSE_ID,
        quantity,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setLog((prev) => [{ part: matchedPart, quantity, at: new Date().toLocaleTimeString() }, ...prev]);
      resetScan();
    } else {
      const err = await res.json();
      alert("Couldn't record receipt: " + JSON.stringify(err.error));
    }
  }

  async function handlePrint() {
    if (!matchedPart) return;
    setPrintStatus("Printing…");
    try {
      await printLabel(
        {
          sku: matchedPart.sku,
          name: matchedPart.name,
          barcodeValue: matchedPart.barcodeValue,
          category: matchedPart.category,
        },
        quantity > 1 ? quantity : 1
      );
      setPrintStatus("Sent to printer");
    } catch (err) {
      setPrintStatus(err instanceof Error ? err.message : "Print failed");
    }
  }

  function resetScan() {
    setScannedBarcode(null);
    setMatchedPart(null);
    setLookupState("idle");
    setQuantity(1);
    setPrintStatus(null);
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-nexus-paper px-4 pb-24 pt-8">
      <h1 className="text-2xl font-medium text-nexus-navy">Warehouse receiving</h1>
      <p className="mt-1 text-nexus-steel">Scan a part to check it into warehouse stock.</p>

      <div className="mt-6">
        <ScannerInput onScan={handleScan} />
      </div>

      {lookupState === "loading" && <p className="mt-4 text-nexus-steel">Looking up part…</p>}

      {lookupState === "not_found" && scannedBarcode && (
        <section className="mt-6 rounded-xl border-2 border-nexus-warn/40 bg-white p-4">
          <p className="font-medium text-nexus-warn">No part matches this barcode yet</p>
          <p className="mt-1 text-sm text-nexus-steel">Barcode: {scannedBarcode}</p>
          <div className="mt-4 flex flex-col gap-3">
            <input
              placeholder="SKU"
              value={newPart.sku}
              onChange={(e) => setNewPart({ ...newPart, sku: e.target.value })}
              className="tap-target rounded-lg border-2 border-nexus-steel/30 px-4"
            />
            <input
              placeholder="Part name"
              value={newPart.name}
              onChange={(e) => setNewPart({ ...newPart, name: e.target.value })}
              className="tap-target rounded-lg border-2 border-nexus-steel/30 px-4"
            />
            <input
              placeholder="Category (optional)"
              value={newPart.category}
              onChange={(e) => setNewPart({ ...newPart, category: e.target.value })}
              className="tap-target rounded-lg border-2 border-nexus-steel/30 px-4"
            />
            <button
              onClick={createPartFromScan}
              disabled={busy || !newPart.sku || !newPart.name}
              className="tap-target rounded-lg bg-nexus-navy font-medium text-white disabled:opacity-40"
            >
              Add part to catalog
            </button>
          </div>
        </section>
      )}

      {matchedPart && (
        <section className="mt-6 rounded-xl border-2 border-nexus-ok/40 bg-white p-4">
          <p className="text-sm text-nexus-steel">{matchedPart.sku}</p>
          <p className="text-lg font-medium text-nexus-navy">{matchedPart.name}</p>
          {matchedPart.category && <p className="text-sm text-nexus-steel">{matchedPart.category}</p>}

          <label className="mt-4 block text-sm text-nexus-steel">Quantity received</label>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
            className="tap-target mt-1 w-32 rounded-lg border-2 border-nexus-steel/30 px-4 text-lg"
          />

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={receivePart}
              disabled={busy}
              className="tap-target flex-1 rounded-lg bg-nexus-ok font-medium text-white disabled:opacity-40"
            >
              Check into warehouse stock
            </button>
            <button
              onClick={handlePrint}
              className="tap-target rounded-lg border-2 border-nexus-navy px-4 font-medium text-nexus-navy"
            >
              Print label{quantity > 1 ? `s (${quantity})` : ""}
            </button>
          </div>
          {printStatus && <p className="mt-2 text-sm text-nexus-steel">{printStatus}</p>}
        </section>
      )}

      {log.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-nexus-steel">Received this session</h2>
          <ul className="mt-2 divide-y divide-nexus-steel/15 rounded-xl border-2 border-nexus-steel/15 bg-white">
            {log.map((entry, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-3">
                <span>
                  {entry.part.name} <span className="text-nexus-steel">({entry.part.sku})</span>
                </span>
                <span className="font-medium">
                  +{entry.quantity} <span className="text-nexus-steel">{entry.at}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
