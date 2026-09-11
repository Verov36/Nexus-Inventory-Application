"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Boxes, Package, AlertTriangle, Download, ScanLine, Search, ClipboardEdit } from "lucide-react";
import { canEditParts, canReceiveWarehouseStock, canViewWarehouseInventory } from "@/lib/roles";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

const DEFAULT_WAREHOUSE_ID = process.env.NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID ?? "";

type InventoryItem = {
  partId: string;
  sku: string;
  name: string;
  category: string | null;
  quantity: number;
  reorderThreshold: number;
  lowStock: boolean;
  updatedAt: string;
};

export default function InventoryHomePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string; canReceiveParts?: boolean } | undefined)?.role;
  const canReceiveParts = (session?.user as { canReceiveParts?: boolean } | undefined)?.canReceiveParts;
  const editable = canEditParts(role);
  const canReceive = canReceiveWarehouseStock(role, canReceiveParts);

  // A truck tech's home is the checkout screen, not the warehouse-wide
  // stock list (which the API refuses them anyway).
  useEffect(() => {
    if (role && !canViewWarehouseInventory(role)) router.replace("/truck/checkout");
  }, [role, router]);

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingThresholdId, setEditingThresholdId] = useState<string | null>(null);
  const [thresholdValue, setThresholdValue] = useState("");
  const [bulkPercent, setBulkPercent] = useState("20");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [showBulkTool, setShowBulkTool] = useState(false);

  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [actualQty, setActualQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustNotice, setAdjustNotice] = useState<string | null>(null);

  function load() {
    setLoadError(null);
    fetch("/api/inventory/warehouse")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (r.status !== 403) {
            setLoadError(typeof d.error === "string" ? d.error : `Couldn't load inventory (${r.status}).`);
          }
          return;
        }
        setItems(d.items ?? []);
      })
      .catch(() => setLoadError("Couldn't reach the server — check your connection."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (lowStockOnly && !i.lowStock) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        (i.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search, lowStockOnly]);

  const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);
  const lowStockCount = items.filter((i) => i.lowStock).length;
  const zeroThresholdCount = items.filter((i) => i.reorderThreshold === 0).length;

  async function saveThreshold(partId: string) {
    const value = Number(thresholdValue);
    if (!Number.isInteger(value) || value < 0) {
      setLoadError("Reorder point must be a whole number of 0 or more.");
      return;
    }
    const res = await fetch(`/api/parts/${partId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reorderThreshold: value }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setLoadError(typeof d.error === "string" ? d.error : `Couldn't save the reorder point (${res.status}).`);
      return;
    }
    setEditingThresholdId(null);
    load();
  }

  async function runBulkPercent() {
    setBulkBusy(true);
    setBulkMessage(null);
    const res = await fetch("/api/parts/bulk-reorder-threshold", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "percentOfStock", percent: Number(bulkPercent) }),
    });
    setBulkBusy(false);
    const data = await res.json();
    if (res.ok) {
      setBulkMessage(`Set a reorder point on ${data.updated} parts (${bulkPercent}% of current stock, minimum 1).`);
      load();
    } else {
      setBulkMessage(typeof data.error === "string" ? data.error : "Couldn't apply.");
    }
  }

  function openAdjust(item: InventoryItem) {
    setAdjustingId(item.partId);
    setActualQty(String(item.quantity));
    setAdjustReason("");
    setAdjustError(null);
    setAdjustNotice(null);
  }

  async function submitAdjust(partId: string) {
    setAdjustBusy(true);
    setAdjustError(null);
    try {
      const res = await fetch("/api/inventory/warehouse-adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partId,
          warehouseId: DEFAULT_WAREHOUSE_ID,
          actualQuantity: Number(actualQty),
          reason: adjustReason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setAdjustBusy(false);
      if (!res.ok) {
        setAdjustError(typeof data.error === "string" ? data.error : `That didn't go through (${res.status}).`);
        return;
      }
      if (data.unchanged) {
        setAdjustNotice(data.message);
        return;
      }
      setAdjustingId(null);
      load();
    } catch {
      setAdjustBusy(false);
      setAdjustError("Couldn't reach the server — check your connection.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 md:pt-10">
      <PageHeader
        title="Warehouse inventory"
        subtitle="Everything currently checked into stock."
        actions={
          <>
            <a href={`/api/inventory/warehouse?format=csv${lowStockOnly ? "&lowStock=true" : ""}`}>
              <Button variant="secondary" icon={<Download size={16} />}>
                {lowStockOnly ? "Export low stock" : "Export"}
              </Button>
            </a>
            {canReceive && (
              <Link href="/warehouse/receiving">
                <Button icon={<ScanLine size={16} />}>Receive parts</Button>
              </Link>
            )}
          </>
        }
      />

      {loadError && (
        <Card accent="danger" className="mt-4 p-3">
          <p className="text-sm text-nexus-danger">{loadError}</p>
        </Card>
      )}

      <div className="mt-5 grid grid-cols-3 gap-3">
        <StatCard icon={<Package size={18} />} label="Parts tracked" value={items.length} />
        <StatCard icon={<Boxes size={18} />} label="Total units" value={totalUnits} />
        <button onClick={() => setLowStockOnly((v) => !v)} className="text-left">
          <StatCard
            icon={<AlertTriangle size={18} />}
            label="Low stock"
            value={lowStockCount}
            tone={lowStockCount > 0 ? "danger" : "neutral"}
            active={lowStockOnly}
          />
        </button>
      </div>

      {editable && zeroThresholdCount > 0 && (
        <Card accent="warn" className="mt-4 p-4">
          <button onClick={() => setShowBulkTool((v) => !v)} className="text-left text-sm font-medium text-nexus-warn">
            {zeroThresholdCount} parts have no reorder point — nothing can flag as low stock until one's set. Tap to fix.
          </button>
          {showBulkTool && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-nexus-steel">Set reorder point to</span>
              <input
                type="number"
                min={1}
                max={100}
                value={bulkPercent}
                onChange={(e) => setBulkPercent(e.target.value)}
                className="tap-target w-16 rounded-lg border-2 border-nexus-line px-2 text-center font-data"
              />
              <span className="text-sm text-nexus-steel">% of current stock (minimum 1) for parts still at 0</span>
              <Button onClick={runBulkPercent} disabled={bulkBusy}>
                Apply
              </Button>
            </div>
          )}
          {bulkMessage && <p className="mt-2 text-sm text-nexus-steel">{bulkMessage}</p>}
        </Card>
      )}

      <div className="mt-6 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nexus-steelfaint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, SKU, or category"
            className="tap-target w-full rounded-lg border-2 border-nexus-line bg-white pl-9 pr-4"
          />
        </div>
        {lowStockOnly && (
          <Button variant="ghost" onClick={() => setLowStockOnly(false)}>
            Clear filter
          </Button>
        )}
      </div>

      {loading && <p className="mt-6 text-nexus-steel">Loading inventory…</p>}

      {!loading && filtered.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={<Package size={32} />}
            title={items.length === 0 ? "Nothing in warehouse stock yet" : "No parts match that search"}
            description={
              items.length === 0
                ? "Receive your first part to start tracking it here."
                : "Try a different name, SKU, or category."
            }
            action={
              items.length === 0 && canReceive ? (
                <Link href="/warehouse/receiving">
                  <Button icon={<ScanLine size={16} />}>Receive parts</Button>
                </Link>
              ) : undefined
            }
          />
        </div>
      )}

      {filtered.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {filtered.map((item) => (
            <Card key={item.partId} as="li" accent={item.lowStock ? "danger" : "none"}>
              <div className="flex items-center justify-between px-4 py-3">
                <Link href={`/parts/${item.partId}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium text-nexus-navy">{item.name}</p>
                  <p className="font-data text-xs text-nexus-steel">
                    {item.sku}
                    {item.category ? ` · ${item.category}` : ""}
                  </p>
                </Link>
                <div className="flex items-center gap-3">
                  {editable &&
                    (editingThresholdId === item.partId ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          value={thresholdValue}
                          onChange={(e) => setThresholdValue(e.target.value)}
                          autoFocus
                          className="w-16 rounded-lg border-2 border-nexus-line px-2 py-1 text-sm"
                        />
                        <button onClick={() => saveThreshold(item.partId)} className="text-xs font-medium text-nexus-ok">
                          Save
                        </button>
                        <button onClick={() => setEditingThresholdId(null)} className="text-xs text-nexus-steel">
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingThresholdId(item.partId);
                          setThresholdValue(String(item.reorderThreshold));
                        }}
                        className="text-xs text-nexus-steelfaint underline decoration-dotted"
                      >
                        reorder at {item.reorderThreshold}
                      </button>
                    ))}
                  <div className="text-right">
                    <p className={`font-data font-semibold ${item.lowStock ? "text-nexus-danger" : "text-nexus-navy"}`}>
                      {item.quantity}
                    </p>
                    {item.lowStock && <p className="text-xs text-nexus-danger">Low stock</p>}
                  </div>
                  {editable && adjustingId !== item.partId && (
                    <button
                      onClick={() => openAdjust(item)}
                      aria-label="Adjust count"
                      className="text-nexus-steelfaint hover:text-nexus-navy"
                    >
                      <ClipboardEdit size={16} />
                    </button>
                  )}
                </div>
              </div>

              {adjustingId === item.partId && (
                <div className="border-t-2 border-nexus-steel/10 bg-nexus-paper px-4 py-3">
                  <p className="text-xs font-medium text-nexus-navy">Correct count for {item.name}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-xs text-nexus-steel">Actual count</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={actualQty}
                      onChange={(e) => setActualQty(e.target.value)}
                      className="w-20 rounded-lg border-2 border-nexus-line px-2 py-1 text-sm font-data"
                    />
                    <span className="text-xs text-nexus-steel">system says {item.quantity}</span>
                  </div>
                  <label className="mt-2 block text-xs text-nexus-steel">Reason (required)</label>
                  <input
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="e.g. physical count, found damaged stock"
                    className="mt-1 w-full rounded-lg border-2 border-nexus-line px-2 py-1 text-sm"
                  />
                  {adjustError && <p className="mt-2 text-xs text-nexus-danger">{adjustError}</p>}
                  {adjustNotice && <p className="mt-2 text-xs text-nexus-steel">{adjustNotice}</p>}
                  <div className="mt-3 flex gap-2">
                    <Button
                      onClick={() => submitAdjust(item.partId)}
                      disabled={
                        adjustBusy ||
                        actualQty === "" ||
                        !Number.isInteger(Number(actualQty)) ||
                        Number(actualQty) < 0 ||
                        !adjustReason.trim()
                      }
                      className="flex-1"
                    >
                      {adjustBusy ? "Saving…" : "Confirm"}
                    </Button>
                    <Button variant="secondary" onClick={() => setAdjustingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = "neutral",
  active,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "neutral" | "danger";
  active?: boolean;
}) {
  return (
    <Card accent={active ? "navy" : "none"} className="p-3 text-center">
      <div className={`mx-auto mb-1 flex w-fit items-center ${tone === "danger" ? "text-nexus-danger" : "text-nexus-steelfaint"}`}>
        {icon}
      </div>
      <p className={`font-data text-xl font-semibold ${tone === "danger" ? "text-nexus-danger" : "text-nexus-navy"}`}>
        {value}
      </p>
      <p className="text-xs text-nexus-steel">{label}</p>
    </Card>
  );
}
