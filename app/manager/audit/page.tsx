"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/money";

type WarehouseItem = {
  partId: string;
  sku: string;
  name: string;
  category: string | null;
  quantity: number;
  reorderThreshold: number;
  lowStock: boolean;
  unitCost: number | null;
  value: number;
};

type TruckItem = {
  partId: string;
  sku: string;
  name: string;
  category: string | null;
  quantity: number;
  cap: number | null;
  overCap: boolean;
  unitCost: number | null;
  value: number;
};

type Truck = { truckId: string; label: string; tech: string | null; value: number; items: TruckItem[] };

export default function AuditPage() {
  const [warehouse, setWarehouse] = useState<WarehouseItem[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [warehouseValue, setWarehouseValue] = useState(0);
  const [trucksValue, setTrucksValue] = useState(0);
  const [uncostedParts, setUncostedParts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetch("/api/reports/inventory-audit")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(typeof d.error === "string" ? d.error : `Couldn't load the audit (${r.status}).`);
          return;
        }
        setWarehouse(d.warehouse ?? []);
        setTrucks(d.trucks ?? []);
        setGeneratedAt(d.generatedAt ?? null);
        setWarehouseValue(d.warehouseValue ?? 0);
        setTrucksValue(d.trucksValue ?? 0);
        setUncostedParts(d.uncostedParts ?? 0);
      })
      .catch(() => setError("Couldn't reach the server — check your connection."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const warehouseTotal = warehouse.reduce((sum, i) => sum + i.quantity, 0);
  const truckTotal = trucks.reduce((sum, t) => sum + t.items.reduce((s, i) => s + i.quantity, 0), 0);

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-nexus-paper px-4 pb-24 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-medium text-nexus-navy">Inventory audit</h1>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="tap-target rounded-lg border-2 border-nexus-steel/30 px-4 text-sm text-nexus-steel"
          >
            Refresh
          </button>
          <a
            href="/api/reports/inventory-audit?format=csv"
            className="tap-target rounded-lg bg-nexus-navy px-4 text-sm font-medium text-white flex items-center"
          >
            Export CSV
          </a>
        </div>
      </div>
      <p className="mt-1 text-sm text-nexus-steel">
        Point-in-time snapshot across every location — use this alongside a physical count to reconcile.
        {generatedAt && ` Generated ${new Date(generatedAt).toLocaleString()}.`}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border-2 border-nexus-steel/15 bg-white p-3 text-center">
          <p className="text-xl font-medium text-nexus-navy">{warehouseTotal}</p>
          <p className="text-xs text-nexus-steel">Units in warehouse</p>
        </div>
        <div className="rounded-xl border-2 border-nexus-steel/15 bg-white p-3 text-center">
          <p className="font-data text-xl font-medium text-nexus-navy">{formatMoney(warehouseValue)}</p>
          <p className="text-xs text-nexus-steel">Warehouse value</p>
        </div>
        <div className="rounded-xl border-2 border-nexus-steel/15 bg-white p-3 text-center">
          <p className="text-xl font-medium text-nexus-navy">{truckTotal}</p>
          <p className="text-xs text-nexus-steel">Units across all trucks</p>
        </div>
        <div className="rounded-xl border-2 border-nexus-steel/15 bg-white p-3 text-center">
          <p className="font-data text-xl font-medium text-nexus-navy">{formatMoney(trucksValue)}</p>
          <p className="text-xs text-nexus-steel">Value on trucks</p>
        </div>
      </div>
      {uncostedParts > 0 && (
        <p className="mt-2 text-xs text-nexus-warn">
          {uncostedParts} {uncostedParts === 1 ? "part has" : "parts have"} no unit cost on file and count as $0 in these
          values.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg border-2 border-nexus-danger/40 bg-white p-3 text-sm text-nexus-danger">{error}</p>
      )}
      {loading && <p className="mt-6 text-nexus-steel">Loading…</p>}

      {!loading && (
        <>
          <section className="mt-6">
            <h2 className="text-sm font-medium text-nexus-steel">Warehouse</h2>
            <ul className="mt-2 divide-y divide-nexus-steel/10 rounded-xl border-2 border-nexus-steel/15 bg-white">
              {warehouse.map((item) => (
                <li key={item.partId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span>
                    {item.name} <span className="text-nexus-steel">({item.sku})</span>
                  </span>
                  <span className="text-right">
                    <span className={item.lowStock ? "font-medium text-nexus-danger" : "font-medium text-nexus-navy"}>
                      {item.quantity}
                    </span>
                    {item.unitCost !== null && (
                      <span className="ml-2 font-data text-xs text-nexus-steel">{formatMoney(item.value)}</span>
                    )}
                  </span>
                </li>
              ))}
              {warehouse.length === 0 && <li className="px-4 py-3 text-nexus-steel">Nothing in warehouse stock.</li>}
            </ul>
          </section>

          {trucks.map((truck) => (
            <section key={truck.truckId} className="mt-6">
              <h2 className="flex items-center justify-between text-sm font-medium text-nexus-steel">
                <span>
                  {truck.label} {truck.tech ? `· ${truck.tech}` : "· unassigned"}
                </span>
                <span className="font-data text-xs">{formatMoney(truck.value)}</span>
              </h2>
              <ul className="mt-2 divide-y divide-nexus-steel/10 rounded-xl border-2 border-nexus-steel/15 bg-white">
                {truck.items.map((item) => (
                  <li key={item.partId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span>
                      {item.name} <span className="text-nexus-steel">({item.sku})</span>
                    </span>
                    <span className="text-right">
                      <span className={item.overCap ? "font-medium text-nexus-danger" : "font-medium text-nexus-navy"}>
                        {item.quantity}
                        {item.cap !== null ? ` / ${item.cap}` : ""}
                      </span>
                      {item.unitCost !== null && (
                        <span className="ml-2 font-data text-xs text-nexus-steel">{formatMoney(item.value)}</span>
                      )}
                    </span>
                  </li>
                ))}
                {truck.items.length === 0 && (
                  <li className="px-4 py-3 text-nexus-steel">Nothing checked out to this truck.</li>
                )}
              </ul>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
