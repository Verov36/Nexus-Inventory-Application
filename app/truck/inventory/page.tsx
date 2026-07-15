"use client";

import { useEffect, useMemo, useState } from "react";

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
  // Alphabetical by category, with Uncategorized pushed to the end rather
  // than sorting wherever "U" happens to land.
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
      <p className="mt-1 text-sm text-nexus-steel">
        Job stock is what's been checked out for a specific work order; truck stock is general restock, not tied to a job.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {trucks.map((truck) => {
          const grouped = groupByCategory(truck.stockLevels);
          return (
            <div key={truck.id} className="rounded-xl border-2 border-nexus-steel/15 bg-white p-4">
              <p className="text-lg font-medium text-nexus-navy">{truck.label}</p>

              {grouped.length === 0 && <p className="mt-2 text-sm text-nexus-steel">Nothing checked out to this truck yet.</p>}

              {grouped.map(([category, items]) => (
                <div key={category} className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-nexus-steel">{category}</p>
                  <ul className="mt-1 divide-y divide-nexus-steel/10 text-sm">
                    {items.map((sl, i) => {
                      const limit = truck.stockLimits.find((l) => l.part?.id === sl.part.id);
                      const overCap = limit && sl.quantity > limit.maxQty;
                      return (
                        <li key={i} className="py-2">
                          <div className="flex items-center justify-between">
                            <span>
                              {sl.part.name}{" "}
                              <span className="font-data text-xs text-nexus-steel">({sl.part.sku})</span>
                            </span>
                            <span className={overCap ? "font-data font-medium text-nexus-danger" : "font-data font-medium"}>
                              {sl.quantity}
                              {limit ? ` / ${limit.maxQty}` : ""}
                            </span>
                          </div>
                          {(sl.jobQuantity > 0 || sl.restockQuantity > 0) && (
                            <div className="mt-1 flex gap-3 text-xs text-nexus-steel">
                              {sl.jobQuantity > 0 && <span>Job stock: {sl.jobQuantity}</span>}
                              {sl.restockQuantity > 0 && <span>Truck stock: {sl.restockQuantity}</span>}
                            </div>
                          )}
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
