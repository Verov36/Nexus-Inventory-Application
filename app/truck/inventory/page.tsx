"use client";

import { useEffect, useState } from "react";

type Truck = {
  id: string;
  label: string;
  stockLevels: { part: { id: string; name: string }; quantity: number }[];
  stockLimits: { part: { id: string; name: string } | null; category: string | null; maxQty: number }[];
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

      <div className="mt-6 flex flex-col gap-4">
        {trucks.map((truck) => (
          <div key={truck.id} className="rounded-xl border-2 border-nexus-steel/15 bg-white p-4">
            <p className="text-lg font-medium text-nexus-navy">{truck.label}</p>
            <ul className="mt-2 divide-y divide-nexus-steel/10 text-sm">
              {truck.stockLevels.map((sl, i) => {
                const limit = truck.stockLimits.find((l) => l.part?.id === sl.part.id);
                const overCap = limit && sl.quantity > limit.maxQty;
                return (
                  <li key={i} className="flex items-center justify-between py-2">
                    <span>{sl.part.name}</span>
                    <span className={overCap ? "font-medium text-nexus-danger" : ""}>
                      {sl.quantity}
                      {limit ? ` / ${limit.maxQty}` : ""}
                    </span>
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
