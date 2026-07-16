"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { canCheckoutToTruck, canManageTrucksAndLimits } from "@/lib/roles";

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
const DEFAULT_WAREHOUSE_ID = process.env.NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID ?? "";

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
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canReturn = canCheckoutToTruck(role) || canManageTrucksAndLimits(role);
  const canWriteOff = canManageTrucksAndLimits(role);

  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [activeAction, setActiveAction] = useState<{ truckId: string; partId: string; mode: "return" | "writeoff" } | null>(
    null
  );
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    fetch("/api/trucks")
      .then((r) => r.json())
      .then((d) => setTrucks(d.trucks ?? []));
  }

  useEffect(() => {
    load();
  }, []);

  function openAction(truckId: string, partId: string, mode: "return" | "writeoff") {
    setActiveAction({ truckId, partId, mode });
    setQuantity("1");
    setReason("");
    setError(null);
    setNotice(null);
  }

  async function submitAction() {
    if (!activeAction) return;
    setBusy(true);
    setError(null);

    const endpoint = activeAction.mode === "return" ? "/api/inventory/return" : "/api/inventory/adjust";
    const body: Record<string, unknown> = {
      partId: activeAction.partId,
      truckId: activeAction.truckId,
      quantity: Number(quantity),
    };
    if (activeAction.mode === "return") {
      body.warehouseId = DEFAULT_WAREHOUSE_ID;
      if (reason) body.notes = reason;
    } else {
      body.reason = reason;
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `That didn't go through (${res.status}).`);
        return;
      }
      setNotice(activeAction.mode === "return" ? "Returned to warehouse." : "Removed from truck stock.");
      setActiveAction(null);
      load();
    } catch {
      setBusy(false);
      setError("Couldn't reach the server — check your connection.");
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-nexus-paper px-4 pb-24 pt-8">
      <h1 className="text-2xl font-medium text-nexus-navy">Truck inventory</h1>

      {notice && (
        <p className="mt-4 rounded-lg border-2 border-nexus-ok/40 bg-white p-3 text-sm text-nexus-ok">{notice}</p>
      )}

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
                      const isActionRow =
                        activeAction?.truckId === truck.id && activeAction?.partId === sl.part.id;
                      return (
                        <li key={i} className="py-2">
                          <div className="grid grid-cols-[1fr,3.5rem,3.5rem,4rem] items-center gap-x-2">
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
                          </div>

                          {(canReturn || canWriteOff) && !isActionRow && (
                            <div className="mt-1 flex gap-3">
                              {canReturn && (
                                <button
                                  onClick={() => openAction(truck.id, sl.part.id, "return")}
                                  className="text-xs text-nexus-navy underline"
                                >
                                  Return to warehouse
                                </button>
                              )}
                              {canWriteOff && (
                                <button
                                  onClick={() => openAction(truck.id, sl.part.id, "writeoff")}
                                  className="text-xs text-nexus-danger underline"
                                >
                                  Write off
                                </button>
                              )}
                            </div>
                          )}

                          {isActionRow && (
                            <div className="mt-2 rounded-lg border-2 border-nexus-steel/15 bg-nexus-paper p-3">
                              <p className="text-xs font-medium text-nexus-navy">
                                {activeAction.mode === "return"
                                  ? `Return ${sl.part.name} to warehouse`
                                  : `Write off ${sl.part.name}`}
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                <label className="text-xs text-nexus-steel">Qty</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={sl.quantity}
                                  value={quantity}
                                  onChange={(e) => setQuantity(e.target.value)}
                                  className="w-20 rounded-lg border-2 border-nexus-steel/30 px-2 py-1 text-sm"
                                />
                                <span className="text-xs text-nexus-steel">of {sl.quantity} on truck</span>
                              </div>
                              {activeAction.mode === "writeoff" ? (
                                <>
                                  <label className="mt-2 block text-xs text-nexus-steel">
                                    Reason (required — lost, damaged, count correction)
                                  </label>
                                  <input
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    className="mt-1 w-full rounded-lg border-2 border-nexus-steel/30 px-2 py-1 text-sm"
                                  />
                                </>
                              ) : (
                                <>
                                  <label className="mt-2 block text-xs text-nexus-steel">Note (optional)</label>
                                  <input
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    className="mt-1 w-full rounded-lg border-2 border-nexus-steel/30 px-2 py-1 text-sm"
                                  />
                                </>
                              )}
                              {error && <p className="mt-2 text-xs text-nexus-danger">{error}</p>}
                              <div className="mt-3 flex gap-2">
                                <button
                                  onClick={submitAction}
                                  disabled={
                                    busy ||
                                    !quantity ||
                                    Number(quantity) < 1 ||
                                    Number(quantity) > sl.quantity ||
                                    (activeAction.mode === "writeoff" && !reason)
                                  }
                                  className={`tap-target flex-1 rounded-lg text-sm font-medium text-white disabled:opacity-40 ${
                                    activeAction.mode === "writeoff" ? "bg-nexus-danger" : "bg-nexus-ok"
                                  }`}
                                >
                                  {busy ? "Submitting…" : "Confirm"}
                                </button>
                                <button
                                  onClick={() => setActiveAction(null)}
                                  className="tap-target rounded-lg border-2 border-nexus-steel/30 px-4 text-sm text-nexus-steel"
                                >
                                  Cancel
                                </button>
                              </div>
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
