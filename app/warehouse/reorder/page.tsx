"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, ClipboardCopy, PackageCheck, RotateCcw, ShoppingCart } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatMoney, money } from "@/lib/money";

type Item = {
  partId: string;
  sku: string;
  name: string;
  category: string | null;
  supplier: string | null;
  supplierPartNumber: string | null;
  quantity: number;
  reorderThreshold: number;
  reorderQty: number;
  suggestedQty: number;
  unitCost: number | null;
  estimatedCost: number;
  orderedAt: string | null;
  orderedQty: number | null;
  orderedBy: string | null;
};

const NO_SUPPLIER = "No supplier set";

export default function ReorderPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [noReorderPoint, setNoReorderPoint] = useState(0);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showOrdered, setShowOrdered] = useState(true);

  function load() {
    setLoading(true);
    setError(null);
    fetch("/api/reorder")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(typeof d.error === "string" ? d.error : `Couldn't load the reorder list (${r.status}).`);
          return;
        }
        const list: Item[] = d.items ?? [];
        setItems(list);
        setNoReorderPoint(d.noReorderPoint ?? 0);
        setQty((prev) => {
          const next = { ...prev };
          for (const i of list) if (next[i.partId] === undefined) next[i.partId] = String(i.suggestedQty);
          return next;
        });
      })
      .catch(() => setError("Couldn't reach the server — check your connection."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const groups = useMemo(() => {
    const visible = items.filter((i) => showOrdered || !i.orderedAt);
    const map = new Map<string, Item[]>();
    for (const i of visible) {
      const key = i.supplier ?? NO_SUPPLIER;
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === NO_SUPPLIER) return 1;
      if (b === NO_SUPPLIER) return -1;
      return a.localeCompare(b);
    });
  }, [items, showOrdered]);

  const openItems = items.filter((i) => !i.orderedAt);
  const orderedItems = items.filter((i) => i.orderedAt);
  const openTotal = money(
    openItems.reduce((sum, i) => {
      const q = Number(qty[i.partId] ?? i.suggestedQty);
      return sum + (i.unitCost === null || !Number.isFinite(q) ? 0 : q * i.unitCost);
    }, 0)
  );

  async function act(item: Item, action: "ordered" | "clear") {
    setError(null);
    setNotice(null);
    const quantity = Number(qty[item.partId] ?? item.suggestedQty);
    if (action === "ordered" && (!Number.isInteger(quantity) || quantity < 1)) {
      setError(`Enter a whole-number order quantity for ${item.name}.`);
      return;
    }
    setBusyId(item.partId);
    try {
      const res = await fetch("/api/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "ordered" ? { action, partId: item.partId, quantity } : { action, partId: item.partId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : `That didn't go through (${res.status}).`);
        return;
      }
      setNotice(action === "ordered" ? `${item.name} marked as ordered (${quantity}).` : `${item.name} put back on the to-order list.`);
      load();
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setBusyId(null);
    }
  }

  async function copyGroup(supplier: string, groupItems: Item[]) {
    const lines = groupItems
      .filter((i) => !i.orderedAt)
      .map((i) => {
        const q = qty[i.partId] ?? String(i.suggestedQty);
        const ref = i.supplierPartNumber ? `${i.supplierPartNumber} — ` : "";
        return `${q} × ${ref}${i.name} (our SKU ${i.sku})`;
      });
    if (lines.length === 0) {
      setNotice("Nothing left to order from this supplier.");
      return;
    }
    const text = `Order for ${supplier === NO_SUPPLIER ? "supplier" : supplier}:\n${lines.join("\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`Copied ${lines.length} ${lines.length === 1 ? "line" : "lines"} for ${supplier} — paste it into an email or PO.`);
    } catch {
      setError("Couldn't copy to the clipboard in this browser — use Export CSV instead.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 md:pt-10">
      <PageHeader
        title="Reorder list"
        subtitle="Parts at or below their reorder point, grouped by supplier."
        actions={
          <a href="/api/reorder?format=csv">
            <Button variant="secondary" icon={<Download size={16} />}>
              Export CSV
            </Button>
          </a>
        }
      />

      <div className="mt-5 grid grid-cols-3 gap-3">
        <Stat label="To order" value={openItems.length} />
        <Stat label="On order" value={orderedItems.length} />
        <Stat label="Est. cost to order" value={formatMoney(openTotal)} />
      </div>

      {noReorderPoint > 0 && (
        <p className="mt-3 text-xs text-nexus-steel">
          {noReorderPoint} {noReorderPoint === 1 ? "part has" : "parts have"} no reorder point and can never show up here.{" "}
          <Link href="/" className="underline">
            Set reorder points on the inventory page.
          </Link>
        </p>
      )}

      {error && (
        <Card accent="danger" className="mt-4 p-3">
          <p className="text-sm text-nexus-danger">{error}</p>
        </Card>
      )}
      {notice && (
        <Card accent="ok" className="mt-4 p-3">
          <p className="text-sm text-nexus-ok">{notice}</p>
        </Card>
      )}

      <label className="mt-4 flex items-center gap-2 text-sm text-nexus-steel">
        <input type="checkbox" checked={showOrdered} onChange={(e) => setShowOrdered(e.target.checked)} />
        Show parts already on order
      </label>

      {loading && <p className="mt-6 text-nexus-steel">Loading…</p>}

      {!loading && groups.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={<ShoppingCart size={32} />}
            title="Nothing to reorder"
            description="Every part with a reorder point is above it. Come back after the next batch of checkouts."
          />
        </div>
      )}

      {groups.map(([supplier, groupItems]) => {
        const groupOpen = groupItems.filter((i) => !i.orderedAt);
        return (
          <section key={supplier} className="mt-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-bold text-nexus-navy">
                {supplier}{" "}
                <span className="text-sm font-normal text-nexus-steel">
                  {groupOpen.length} to order
                </span>
              </h2>
              <Button variant="ghost" icon={<ClipboardCopy size={16} />} onClick={() => copyGroup(supplier, groupItems)}>
                Copy order
              </Button>
            </div>
            <ul className="mt-2 flex flex-col gap-2">
              {groupItems.map((i) => {
                const ordered = !!i.orderedAt;
                return (
                  <Card key={i.partId} as="li" accent={ordered ? "ok" : "warn"} className="p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <Link href={`/parts/${i.partId}`} className="block truncate font-medium text-nexus-navy">
                          {i.name}
                        </Link>
                        <p className="font-data text-xs text-nexus-steel">
                          {i.sku}
                          {i.supplierPartNumber ? ` · supplier # ${i.supplierPartNumber}` : ""}
                          {i.category ? ` · ${i.category}` : ""}
                        </p>
                        <p className="mt-0.5 text-xs text-nexus-steel">
                          On hand <span className="font-data text-nexus-danger">{i.quantity}</span> · reorder at{" "}
                          <span className="font-data">{i.reorderThreshold}</span>
                          {i.unitCost !== null ? ` · ${formatMoney(i.unitCost)} each` : " · no cost on file"}
                        </p>
                      </div>

                      {ordered ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-nexus-ok">
                            <PackageCheck size={14} className="mr-1 inline" />
                            {i.orderedQty} ordered {new Date(i.orderedAt!).toLocaleDateString()}
                            {i.orderedBy ? ` by ${i.orderedBy}` : ""}
                          </span>
                          <button
                            onClick={() => act(i, "clear")}
                            disabled={busyId === i.partId}
                            title="Put back on the to-order list"
                            className="tap-target rounded-lg border-2 border-nexus-line px-2 text-nexus-steel disabled:opacity-40"
                          >
                            <RotateCcw size={16} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-nexus-steel">Order</label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            value={qty[i.partId] ?? String(i.suggestedQty)}
                            onChange={(e) => setQty((prev) => ({ ...prev, [i.partId]: e.target.value }))}
                            className="tap-target w-20 rounded-lg border-2 border-nexus-line px-2 text-center font-data"
                          />
                          {i.unitCost !== null && (
                            <span className="w-20 text-right font-data text-xs text-nexus-steel">
                              {formatMoney(money(Number(qty[i.partId] ?? i.suggestedQty) * i.unitCost) || 0)}
                            </span>
                          )}
                          <Button onClick={() => act(i, "ordered")} disabled={busyId === i.partId} variant="secondary">
                            {busyId === i.partId ? "Saving…" : "Mark ordered"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </ul>
          </section>
        );
      })}

      <p className="mt-8 text-xs text-nexus-steel">
        &quot;Mark ordered&quot; just records that someone placed the order so it stops showing as to-do. The flag clears
        itself when the part is next received.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-3 text-center">
      <p className="font-data text-xl font-semibold text-nexus-navy">{value}</p>
      <p className="text-xs text-nexus-steel">{label}</p>
    </Card>
  );
}
