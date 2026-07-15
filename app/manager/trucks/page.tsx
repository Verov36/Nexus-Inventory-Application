"use client";

import { useEffect, useState } from "react";

type Truck = {
  id: string;
  label: string;
  active: boolean;
  tech: { id: string; name: string; email: string } | null;
  stockLevels: { part: { name: string }; quantity: number }[];
  stockLimits: { id: string; part: { name: string } | null; category: string | null; maxQty: number }[];
};

export default function ManagerTrucksPage() {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [newTruckLabel, setNewTruckLabel] = useState("");
  const [limitForm, setLimitForm] = useState<Record<string, { partId: string; maxQty: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

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

  async function toggleActive(truckId: string, active: boolean) {
    setError(null);
    setNotice(null);
    await fetch(`/api/trucks/${truckId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    loadTrucks();
  }

  async function deleteTruck(truckId: string, label: string) {
    if (!confirm(`Delete ${label}? This can't be undone if it succeeds.`)) return;
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/trucks/${truckId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Couldn't delete truck.");
      return;
    }
    if (data.deactivated) {
      setNotice(data.message);
    }
    loadTrucks();
  }

  const visibleTrucks = trucks.filter((t) => showInactive || t.active);

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-nexus-paper px-4 pb-24 pt-8">
      <h1 className="text-2xl font-medium text-nexus-navy">Trucks</h1>
      <p className="mt-1 text-nexus-steel">Assign techs and set how much stock each truck can carry.</p>

      {error && (
        <p className="mt-4 rounded-lg border-2 border-nexus-danger/40 bg-white p-3 text-sm text-nexus-danger">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 rounded-lg border-2 border-nexus-warn/40 bg-white p-3 text-sm text-nexus-warn">
          {notice}
        </p>
      )}

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

      <label className="mt-3 flex items-center gap-2 text-sm text-nexus-steel">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Show deactivated trucks
      </label>

      <div className="mt-4 flex flex-col gap-4">
        {visibleTrucks.map((truck) => (
          <div
            key={truck.id}
            className={`rounded-xl border-2 bg-white p-4 ${truck.active ? "border-nexus-steel/15" : "border-nexus-steel/15 opacity-60"}`}
          >
            <div className="flex items-center justify-between">
              <p className="text-lg font-medium text-nexus-navy">
                {truck.label} {!truck.active && <span className="text-sm text-nexus-steel">(deactivated)</span>}
              </p>
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

            {truck.active && (
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
            )}

            <div className="mt-3 flex gap-2">
              {truck.active ? (
                <button
                  onClick={() => toggleActive(truck.id, false)}
                  className="tap-target rounded-lg border-2 border-nexus-warn/40 px-3 text-sm text-nexus-warn"
                >
                  Deactivate
                </button>
              ) : (
                <button
                  onClick={() => toggleActive(truck.id, true)}
                  className="tap-target rounded-lg border-2 border-nexus-ok/40 px-3 text-sm text-nexus-ok"
                >
                  Reactivate
                </button>
              )}
              <button
                onClick={() => deleteTruck(truck.id, truck.label)}
                className="tap-target rounded-lg border-2 border-nexus-danger/40 px-3 text-sm text-nexus-danger"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
