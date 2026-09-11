"use client";

import { useState } from "react";
import Link from "next/link";
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

// Sent along as a hint; the server falls back to its own default warehouse
// if this wasn't baked into the client bundle at build time.
const DEFAULT_WAREHOUSE_ID = process.env.NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID ?? "";

/** Reads a fetch Response as JSON, tolerating a non-JSON body (raw 500 page,
 * empty response, etc.) instead of throwing and silently killing the caller. */
async function safeJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export default function ReceivingPage() {
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [matchedPart, setMatchedPart] = useState<Part | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "not_found">("idle");
  const [quantity, setQuantity] = useState("1");
  const [newPart, setNewPart] = useState({ sku: "", name: "", category: "" });
  const [log, setLog] = useState<ReceivedEntry[]>([]);
  const [printStatus, setPrintStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const qty = Number(quantity);
  const qtyValid = Number.isInteger(qty) && qty >= 1;

  async function handleScan(barcode: string) {
    setScannedBarcode(barcode);
    setMatchedPart(null);
    setLookupState("loading");
    setPrintStatus(null);
    setError(null);
    try {
      const res = await fetch(`/api/parts?barcode=${encodeURIComponent(barcode)}`);
      const data = await safeJson(res);
      if (!res.ok) {
        setLookupState("idle");
        setError(typeof data.error === "string" ? data.error : `Couldn't look up that barcode (${res.status}).`);
        return;
      }
      if (data.part) {
        setMatchedPart(data.part as Part);
        setLookupState("idle");
      } else {
        setMatchedPart(null);
        setLookupState("not_found");
        setNewPart({ sku: "", name: "", category: "" });
      }
    } catch {
      setLookupState("idle");
      setError("Couldn't reach the server to look up that barcode — check your connection.");
    }
  }

  async function createPartFromScan() {
    if (!scannedBarcode) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/parts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: newPart.sku.trim(),
          name: newPart.name.trim(),
          category: newPart.category.trim() || undefined,
          barcodeValue: scannedBarcode,
        }),
      });
      setBusy(false);
      const data = await safeJson(res);
      if (res.ok) {
        setMatchedPart(data.part as Part);
        setLookupState("idle");
      } else {
        setError(typeof data.error === "string" ? data.error : `Couldn't create the part (${res.status}).`);
      }
    } catch {
      setBusy(false);
      setError("Couldn't reach the server to create the part — check your connection.");
    }
  }

  async function receivePart() {
    if (!matchedPart || !qtyValid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partId: matchedPart.id,
          warehouseId: DEFAULT_WAREHOUSE_ID || undefined,
          quantity: qty,
        }),
      });
      setBusy(false);
      const data = await safeJson(res);
      if (res.ok) {
        setLog((prev) => [{ part: matchedPart, quantity: qty, at: new Date().toLocaleTimeString() }, ...prev]);
        resetScan();
      } else {
        setError(
          typeof data.error === "string"
            ? data.error
            : `Couldn't record the receipt (${res.status}). Nothing was added to inventory — try again.`
        );
      }
    } catch {
      setBusy(false);
      setError("Couldn't reach the server — check your connection. Nothing was added to inventory.");
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
        qtyValid && qty > 1 ? qty : 1
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
    setQuantity("1");
    setPrintStatus(null);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 md:pt-10">
      <PageHeader title="Receiving" subtitle="Scan a part to check it into warehouse stock." />

      <div className="mt-6">
        <ScannerInput onScan={handleScan} />
      </div>

      {error && (
        <Card accent="danger" className="mt-4 p-3">
          <p className="text-sm text-nexus-danger">{error}</p>
        </Card>
      )}

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
              disabled={busy || !newPart.sku.trim() || !newPart.name.trim()}
              icon={<PackagePlus size={16} />}
            >
              {busy ? "Adding…" : "Add to catalog"}
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
            step={1}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={() => {
              if (!qtyValid) setQuantity("1");
            }}
            className="tap-target mt-1 w-32 rounded-lg border-2 border-nexus-line px-4 font-data text-lg"
          />

          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={receivePart} disabled={busy || !qtyValid} icon={<CheckCircle2 size={16} />} className="flex-1">
              {busy ? "Saving…" : "Check into stock"}
            </Button>
            <Button onClick={handlePrint} variant="secondary" icon={<Printer size={16} />}>
              Print {qtyValid && qty > 1 ? `(${qty})` : "label"}
            </Button>
          </div>
          {printStatus && <p className="mt-2 text-sm text-nexus-steel">{printStatus}</p>}
          <p className="mt-2 text-xs text-nexus-steel">
            No Zebra printer?{" "}
            <Link href={`/warehouse/labels?ids=${matchedPart.id}`} className="underline">
              Print on a label sheet
            </Link>{" "}
            from any printer instead.
          </p>
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
