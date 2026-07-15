"use client";

import { useEffect, useState } from "react";

type Truck = {
  id: string;
  label: string;
  stockLevels: {
    part: { id: string; sku: string; name: string };
    quantity: number;
    jobQuantity: number;
    restockQuantity: number;
  }[];
  stockLimits: { part: { id: string; sku: string; name: string } | null; category: string | null; maxQty: number }[];
};

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
        {trucks.map((truck) => (
          <div key={truck.id} className="rounded-xl border-2 border-nexus-steel/15 bg-white p-4">
            <p className="text-lg font-medium text-nexus-navy">{truck.label}</p>
            <ul className="mt-2 divide-y divide-nexus-steel/10 text-sm">
              {truck.stockLevels.map((sl, i) => {
                const limit = truck.stockLimits.find((l) => l.part?.id === sl.part.id);
                const overCap = limit && sl.quantity > limit.maxQty;
                return (
                  <li key={i} className="py-2">
                    <div className="flex items-center justify-between">
                      <span>
                        {sl.part.name} <span className="font-data text-xs text-nexus-steel">({sl.part.sku})</span>
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
              {truck.stockLevels.length === 0 && (
                <li className="py-2 text-nexus-steel">Nothing checked out to this truck yet.</li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
