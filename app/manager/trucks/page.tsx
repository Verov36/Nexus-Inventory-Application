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

type PartOption = { id: string; sku: string; name: string; category: string | null };

export default function ManagerTrucksPage() {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [newTruckLabel, setNewTruckLabel] = useState("");
  const [limitForm, setLimitForm] = useState<
    Record<string, { query: string; results: PartOption[]; selected: PartOption | null; maxQty: string }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [savingLimitFor, setSavingLimitFor] = useState<string | null>(null);

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

  function getForm(truckId: string) {
    return limitForm[truckId] ?? { query: "", results: [], selected: null, maxQty: "" };
  }

  async function searchParts(truckId: string, query: string) {
    setLimitForm((prev) => ({ ...prev, [truckId]: { ...getForm(truckId), query, selected: null } }));
    if (query.trim().length < 2) {
      setLimitForm((prev) => ({ ...prev, [truckId]: { ...getForm(truckId), query, results: [] } }));
      return;
    }
    const res = await fetch(`/api/parts/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setLimitForm((prev) => ({ ...prev, [truckId]: { ...getForm(truckId), query, results: data.parts ?? [] } }));
  }

  function selectPart(truckId: string, part: PartOption) {
    setLimitForm((prev) => ({
      ...prev,
      [truckId]: { ...getForm(truckId), selected: part, query: part.name, results: [] },
    }));
  }

  async function setLimit(truckId: string) {
    const form = getForm(truckId);
    if (!form.selected || !form.maxQty) {
      setError("Search for and select a part, and enter a max quantity, before setting a cap.");
      return;
    }
    setError(null);
    setNotice(null);
    setSavingLimitFor(truckId);
    const res = await fetch(`/api/trucks/${truckId}/limits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partId: form.selected.id, maxQty: Number(form.maxQty) }),
    });
    setSavingLimitFor(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : `Couldn't set the cap (${res.status}).`);
      return;
    }
    setNotice(`Cap set: ${form.selected.name} → max ${form.maxQty} on this truck.`);
    setLimitForm((prev) => ({ ...prev, [truckId]: { query: "", results: [], selected: null, maxQty: "" } }));
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
        <p className="mt-4 rounded-lg border-2 border-nexus-ok/40 bg-white p-3 text-sm text-nexus-ok">
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
        {visibleTrucks.map((truck) => {
          const form = getForm(truck.id);
          return (
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
                <div className="mt-3">
                  <p className="text-xs uppercase tracking-wide text-nexus-steel">Set a cap</p>
                  <div className="relative mt-1 flex gap-2">
                    <div className="relative flex-1">
                      <input
                        placeholder="Search part by name or SKU"
                        value={form.query}
                        onChange={(e) => searchParts(truck.id, e.target.value)}
                        className="tap-target w-full rounded-lg border-2 border-nexus-steel/30 px-3 text-sm"
                      />
                      {form.results.length > 0 && (
                        <ul className="absolute z-10 mt-1 w-full rounded-lg border-2 border-nexus-steel/20 bg-white shadow-lg">
                          {form.results.map((p) => (
                            <li key={p.id}>
                              <button
                                onClick={() => selectPart(truck.id, p)}
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-nexus-paper"
                              >
                                {p.name} <span className="text-nexus-steel">({p.sku})</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <input
                      placeholder="Max qty"
                      type="number"
                      value={form.maxQty}
                      onChange={(e) =>
                        setLimitForm((prev) => ({ ...prev, [truck.id]: { ...getForm(truck.id), maxQty: e.target.value } }))
                      }
                      className="tap-target w-24 rounded-lg border-2 border-nexus-steel/30 px-3 text-sm"
                    />
                    <button
                      onClick={() => setLimit(truck.id)}
                      disabled={savingLimitFor === truck.id || !form.selected || !form.maxQty}
                      className="tap-target rounded-lg border-2 border-nexus-navy px-3 text-sm font-medium text-nexus-navy disabled:opacity-40"
                    >
                      {savingLimitFor === truck.id ? "Saving…" : "Set cap"}
                    </button>
                  </div>
                  {form.selected && (
                    <p className="mt-1 text-xs text-nexus-ok">Selected: {form.selected.name}</p>
                  )}
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
          );
        })}
      </div>
    </main>
  );
}
