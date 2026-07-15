"use client";

import { useState } from "react";
import ScannerInput from "@/components/ScannerInput";
import { printLabel } from "@/lib/zebra-print";
import { PackagePlus, Printer, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

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
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 md:pt-10">
      <PageHeader title="Receiving" subtitle="Scan a part to check it into warehouse stock." />

      <div className="mt-6">
        <ScannerInput onScan={handleScan} />
      </div>

      {lookupState === "loading" && <p className="mt-4 text-nexus-steel">Looking up part…</p>}

      {lookupState === "not_found" && scannedBarcode && (
        <Card accent="warn" className="mt-6 p-4">
          <p className="font-medium text-nexus-warn">No part matches this barcode yet</p>
          <p className="mt-1 font-data text-sm text-nexus-steel">{scannedBarcode}</p>
          <div className="mt-4 flex flex-col gap-3">
            <input
              placeholder="SKU"
              value={newPart.sku}
              onChange={(e) => setNewPart({ ...newPart, sku: e.target.value })}
              className="tap-target rounded-lg border-2 border-nexus-line px-4 font-data"
            />
            <input
              placeholder="Part name"
              value={newPart.name}
              onChange={(e) => setNewPart({ ...newPart, name: e.target.value })}
              className="tap-target rounded-lg border-2 border-nexus-line px-4"
            />
            <input
              placeholder="Category (optional)"
              value={newPart.category}
              onChange={(e) => setNewPart({ ...newPart, category: e.target.value })}
              className="tap-target rounded-lg border-2 border-nexus-line px-4"
            />
            <Button
              onClick={createPartFromScan}
              disabled={busy || !newPart.sku || !newPart.name}
              icon={<PackagePlus size={16} />}
            >
              Add to catalog
            </Button>
          </div>
        </Card>
      )}

      {matchedPart && (
        <Card accent="ok" className="mt-6 p-4">
          <p className="font-data text-xs text-nexus-steel">{matchedPart.sku}</p>
          <p className="font-display text-lg font-bold text-nexus-navy">{matchedPart.name}</p>
          {matchedPart.category && <p className="text-sm text-nexus-steel">{matchedPart.category}</p>}

          <label className="mt-4 block text-sm text-nexus-steel">Quantity received</label>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
            className="tap-target mt-1 w-32 rounded-lg border-2 border-nexus-line px-4 font-data text-lg"
          />

          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={receivePart} disabled={busy} icon={<CheckCircle2 size={16} />} className="flex-1">
              Check into stock
            </Button>
            <Button onClick={handlePrint} variant="secondary" icon={<Printer size={16} />}>
              Print {quantity > 1 ? `(${quantity})` : "label"}
            </Button>
          </div>
          {printStatus && <p className="mt-2 text-sm text-nexus-steel">{printStatus}</p>}
        </Card>
      )}

      {log.length === 0 && lookupState === "idle" && !matchedPart && (
        <div className="mt-8">
          <EmptyState
            icon={<PackagePlus size={32} />}
            title="Nothing received this session"
            description="Scan a barcode above to check the first part into warehouse stock."
          />
        </div>
      )}

      {log.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-nexus-steel">Received this session</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {log.map((entry, i) => (
              <Card key={i} as="li" accent="ok">
                <div className="flex items-center justify-between px-4 py-3">
                  <span>
                    {entry.part.name}{" "}
                    <span className="font-data text-xs text-nexus-steel">({entry.part.sku})</span>
                  </span>
                  <span className="font-data font-medium text-nexus-ok">
                    +{entry.quantity} <span className="text-nexus-steel">{entry.at}</span>
                  </span>
                </div>
              </Card>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
