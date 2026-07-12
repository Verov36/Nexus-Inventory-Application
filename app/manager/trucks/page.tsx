"use client";

import { useEffect, useState } from "react";

type Truck = {
  id: string;
  label: string;
  tech: { id: string; name: string; email: string } | null;
  stockLevels: { part: { name: string }; quantity: number }[];
  stockLimits: { id: string; part: { name: string } | null; category: string | null; maxQty: number }[];
};

export default function ManagerTrucksPage() {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [newTruckLabel, setNewTruckLabel] = useState("");
  const [limitForm, setLimitForm] = useState<Record<string, { partId: string; maxQty: string }>>({});

  async function loadTrucks() {
    const res = await fetch("/api/trucks");
    const data = await res.json();
    setTrucks(data.trucks ?? []);
  }

  useEffect(() => {
    loadTrucks();
  }, []);

  async function createTruck() {
    if (!newTruckLabel.trim()) return;
    await fetch("/api/trucks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newTruckLabel }),
    });
    setNewTruckLabel("");
    loadTrucks();
  }

  async function setLimit(truckId: string) {
    const form = limitForm[truckId];
    if (!form?.partId || !form.maxQty) return;
    await fetch(`/api/trucks/${truckId}/limits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partId: form.partId, maxQty: Number(form.maxQty) }),
    });
    setLimitForm((prev) => ({ ...prev, [truckId]: { partId: "", maxQty: "" } }));
    loadTrucks();
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-nexus-paper px-4 pb-24 pt-8">
      <h1 className="text-2xl font-medium text-nexus-navy">Trucks</h1>
      <p className="mt-1 text-nexus-steel">Assign techs and set how much stock each truck can carry.</p>

      <div className="mt-4 flex gap-2">
        <input
          value={newTruckLabel}
          onChange={(e) => setNewTruckLabel(e.target.value)}
          placeholder="New truck label, e.g. Truck 4"
          className="tap-target flex-1 rounded-lg border-2 border-nexus-steel/30 bg-white px-4"
        />
        <button onClick={createTruck} className="tap-target rounded-lg bg-nexus-navy px-4 font-medium text-white">
          Add truck
        </button>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {trucks.map((truck) => (
          <div key={truck.id} className="rounded-xl border-2 border-nexus-steel/15 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-lg font-medium text-nexus-navy">{truck.label}</p>
              <p className="text-sm text-nexus-steel">
                {truck.tech ? `Assigned: ${truck.tech.name}` : "Unassigned"}
              </p>
            </div>

            {truck.stockLevels.length > 0 && (
              <ul className="mt-3 divide-y divide-nexus-steel/10 text-sm">
                {truck.stockLevels.map((sl, i) => (
                  <li key={i} className="flex justify-between py-1">
                    <span>{sl.part.name}</span>
                    <span>{sl.quantity}</span>
                  </li>
                ))}
              </ul>
            )}

            {truck.stockLimits.length > 0 && (
              <div className="mt-3">
                <p className="text-xs uppercase tracking-wide text-nexus-steel">Caps</p>
                <ul className="text-sm">
                  {truck.stockLimits.map((l) => (
                    <li key={l.id}>
                      {(l.part?.name ?? l.category) as string}: max {l.maxQty}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <input
                placeholder="Part id"
                value={limitForm[truck.id]?.partId ?? ""}
                onChange={(e) =>
                  setLimitForm((prev) => ({
                    ...prev,
                    [truck.id]: { partId: e.target.value, maxQty: prev[truck.id]?.maxQty ?? "" },
                  }))
                }
                className="tap-target flex-1 rounded-lg border-2 border-nexus-steel/30 px-3 text-sm"
              />
              <input
                placeholder="Max qty"
                type="number"
                value={limitForm[truck.id]?.maxQty ?? ""}
                onChange={(e) =>
                  setLimitForm((prev) => ({
                    ...prev,
                    [truck.id]: { partId: prev[truck.id]?.partId ?? "", maxQty: e.target.value },
                  }))
                }
                className="tap-target w-28 rounded-lg border-2 border-nexus-steel/30 px-3 text-sm"
              />
              <button
                onClick={() => setLimit(truck.id)}
                className="tap-target rounded-lg border-2 border-nexus-navy px-3 text-sm font-medium text-nexus-navy"
              >
                Set cap
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
