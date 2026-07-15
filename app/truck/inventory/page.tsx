"use client";

import { useEffect, useState } from "react";

type StockItem = {
  part: { id: string; sku: string; name: string; category: string | null };
  quantity: number;
  jobQuantity: number;
  restockQuantity: number;
};

type Truck = {
  id: string;
  label: string;
  stockLevels: StockItem[];
  stockLimits: { part: { id: string; sku: string; name: string } | null; category: string | null; maxQty: number }[];
};

const UNCATEGORIZED = "Uncategorized";

function groupByCategory(items: StockItem[]) {
  const groups = new Map<string, StockItem[]>();
  for (const item of items) {
    const key = item.part.category?.trim() || UNCATEGORIZED;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const items of groups.values()) {
    items.sort((a, b) => a.part.name.localeCompare(b.part.name));
  }
  return Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b);
  });
}

export default function TruckInventoryPage() {
  const [trucks, setTrucks] = useState<Truck[]>([]);

  useEffect(() => {
    fetch("/api/trucks")
      .then((r) => r.json())
      .then((d) => setTrucks(d.trucks ?? []));
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-nexus-paper px-4 pb-24 pt-8">
      <h1 className="text-2xl font-medium text-nexus-navy">Truck inventory</h1>

      <div className="mt-6 flex flex-col gap-4">
        {trucks.map((truck) => {
          const grouped = groupByCategory(truck.stockLevels);
          return (
            <div key={truck.id} className="rounded-xl border-2 border-nexus-steel/15 bg-white p-4">
              <p className="text-lg font-medium text-nexus-navy">{truck.label}</p>

              {grouped.length === 0 && <p className="mt-2 text-sm text-nexus-steel">Nothing checked out to this truck yet.</p>}

              {grouped.length > 0 && (
                <div className="mt-3 grid grid-cols-[1fr,3.5rem,3.5rem,4rem] gap-x-2 text-xs font-medium uppercase tracking-wide text-nexus-steel">
                  <span></span>
                  <span className="text-right">Job</span>
                  <span className="text-right">Truck</span>
                  <span className="text-right">Total</span>
                </div>
              )}

              {grouped.map(([category, items]) => (
                <div key={category} className="mt-2">
                  <p className="border-t border-nexus-steel/10 pt-2 text-xs font-medium uppercase tracking-wide text-nexus-steel">
                    {category}
                  </p>
                  <ul className="divide-y divide-nexus-steel/10 text-sm">
                    {items.map((sl, i) => {
                      const limit = truck.stockLimits.find((l) => l.part?.id === sl.part.id);
                      const overCap = limit && sl.quantity > limit.maxQty;
                      return (
                        <li
                          key={i}
                          className="grid grid-cols-[1fr,3.5rem,3.5rem,4rem] items-center gap-x-2 py-2"
                        >
                          <span className="truncate">
                            {sl.part.name}{" "}
                            <span className="font-data text-xs text-nexus-steel">({sl.part.sku})</span>
                          </span>
                          <span className="text-right font-data text-nexus-steel">{sl.jobQuantity || "–"}</span>
                          <span className="text-right font-data text-nexus-steel">{sl.restockQuantity || "–"}</span>
                          <span className={`text-right font-data font-medium ${overCap ? "text-nexus-danger" : "text-nexus-navy"}`}>
                            {sl.quantity}
                            {limit ? `/${limit.maxQty}` : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </main>
  );
}
