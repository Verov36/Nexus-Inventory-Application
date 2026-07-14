"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/inventory/warehouse")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems(d.items ?? []))
      .finally(() => setLoading(false));
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

  const totalParts = items.length;
  const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);
  const lowStockCount = items.filter((i) => i.lowStock).length;

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-nexus-paper px-4 pb-24 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-medium text-nexus-navy">Warehouse inventory</h1>
        <div className="flex gap-2">
          <a
            href="/api/inventory/warehouse?format=csv"
            className="tap-target rounded-lg border-2 border-nexus-navy px-4 text-sm font-medium text-nexus-navy flex items-center"
          >
            Export CSV
          </a>
          <Link
            href="/warehouse/receiving"
            className="tap-target rounded-lg bg-nexus-navy px-4 text-sm font-medium text-white flex items-center"
          >
            Receive parts
          </Link>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Parts tracked" value={totalParts} />
        <Stat label="Total units" value={totalUnits} />
        <button onClick={() => setLowStockOnly((v) => !v)} className="text-left">
          <Stat label="Low stock (tap to filter)" value={lowStockCount} alert={lowStockCount > 0} active={lowStockOnly} />
        </button>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, SKU, or category"
          className="tap-target flex-1 rounded-lg border-2 border-nexus-steel/30 bg-white px-4"
        />
        {lowStockOnly && (
          <button
            onClick={() => setLowStockOnly(false)}
            className="tap-target rounded-lg border-2 border-nexus-steel/30 px-3 text-sm text-nexus-steel"
          >
            Clear filter
          </button>
        )}
      </div>

      {loading && <p className="mt-6 text-nexus-steel">Loading inventory…</p>}

      {!loading && filtered.length === 0 && (
        <p className="mt-6 text-nexus-steel">
          {items.length === 0
            ? "Nothing in warehouse stock yet — start by receiving parts."
            : "No parts match that search."}
        </p>
      )}

      {filtered.length > 0 && (
        <ul className="mt-4 divide-y divide-nexus-steel/10 rounded-xl border-2 border-nexus-steel/15 bg-white">
          {filtered.map((item) => (
            <li key={item.partId}>
              <Link href={`/parts/${item.partId}`} className="flex items-center justify-between px-4 py-3 hover:bg-nexus-paper">
                <div>
                  <p className="font-medium text-nexus-navy">{item.name}</p>
                  <p className="text-sm text-nexus-steel">
                    {item.sku}
                    {item.category ? ` · ${item.category}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`font-medium ${item.lowStock ? "text-nexus-danger" : "text-nexus-navy"}`}>
                    {item.quantity}
                  </p>
                  {item.lowStock && <p className="text-xs text-nexus-danger">Low stock</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  alert,
  active,
}: {
  label: string;
  value: number;
  alert?: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border-2 bg-white p-3 text-center ${
        active ? "border-nexus-navy" : alert ? "border-nexus-danger/40" : "border-nexus-steel/15"
      }`}
    >
      <p className={`text-xl font-medium ${alert ? "text-nexus-danger" : "text-nexus-navy"}`}>{value}</p>
      <p className="text-xs text-nexus-steel">{label}</p>
    </div>
  );
}
