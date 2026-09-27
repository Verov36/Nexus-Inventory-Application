"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Minus, PackageCheck, Plus, Wrench } from "lucide-react";
import ScannerInput from "@/components/ScannerInput";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

type StockItem = {
  part: { id: string; sku: string; name: string; category: string | null; barcodeValue: string };
  quantity: number;
};
type Truck = { id: string; label: string; active: boolean; techId: string | null; stockLevels: StockItem[] };

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Parts installed at a customer come off the truck here. Loading a truck
// "for a job" only moves stock; this is what records the job's parts cost.
export default function UseOnJobPage() {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [truckId, setTruckId] = useState("");
  const [loading, setLoading] = useState(true);
  const [jobNumber, setJobNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [used, setUsed] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // One key per submission attempt: a retry after a timeout reuses it, so
  // the server records the parts once. A fresh key after each success.
  const attemptKey = useRef(newKey());

  function load(keepTruck?: string) {
    fetch("/api/trucks")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(typeof d.error === "string" ? d.error : `Couldn't load trucks (${r.status}).`);
          return;
        }
        const active: Truck[] = (d.trucks ?? []).filter((t: Truck) => t.active);
        setTrucks(active);
        const own = active.find((t) => t.techId === userId);
        setTruckId((current) => keepTruck || current || own?.id || active[0]?.id || "");
      })
      .catch(() => setError("Couldn't reach the server — check your connection."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (userId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const truck = trucks.find((t) => t.id === truckId);
  const stock = useMemo(
    () => [...(truck?.stockLevels ?? [])].sort((a, b) => a.part.name.localeCompare(b.part.name)),
    [truck]
  );
  const visible = filter.trim()
    ? stock.filter((s) =>
        `${s.part.name} ${s.part.sku}`.toLowerCase().includes(filter.trim().toLowerCase())
      )
    : stock;
  const lines = Object.entries(used).filter(([, q]) => q > 0);
  const totalUnits = lines.reduce((n, [, q]) => n + q, 0);

  function setQty(partId: string, qty: number) {
    const onTruck = stock.find((s) => s.part.id === partId)?.quantity ?? 0;
    setUsed((u) => ({ ...u, [partId]: Math.max(0, Math.min(onTruck, qty)) }));
    setNotice(null);
  }

  function onScan(value: string) {
    setError(null);
    const hit = stock.find((s) => s.part.barcodeValue === value || s.part.sku === value);
    if (!hit) {
      setError(`Nothing with code "${value}" is on ${truck?.label ?? "this truck"}.`);
      return;
    }
    const next = (used[hit.part.id] ?? 0) + 1;
    if (next > hit.quantity) {
      setError(`Only ${hit.quantity} ${hit.part.name} on the truck.`);
      return;
    }
    setQty(hit.part.id, next);
  }

  async function submit() {
    if (!truck || !jobNumber.trim() || lines.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/inventory/consume", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attemptKey.current },
        body: JSON.stringify({
          truckId: truck.id,
          jobNumber: jobNumber.trim(),
          items: lines.map(([partId, quantity]) => ({ partId, quantity })),
          notes: notes.trim() || undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : `That didn't go through (${res.status}).`);
        return;
      }
      setNotice(`Recorded ${totalUnits} ${totalUnits === 1 ? "part" : "parts"} used on job ${d.jobNumber}.`);
      setUsed({});
      setNotes("");
      attemptKey.current = newKey();
      load(truck.id);
    } catch {
      setError("Couldn't reach the server. Nothing was lost — tap Record again when you have signal.");
    } finally {
      setBusy(false);
    }
  }

  const input = "tap-target w-full rounded-lg border-2 border-nexus-line bg-white px-4";

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-6 md:pt-10">
      <PageHeader
        title="Parts used on a job"
        subtitle="Record what you installed. It comes off your truck and is costed to the job."
      />

      {loading ? (
        <p className="mt-6 text-nexus-steel">Loading…</p>
      ) : trucks.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<Wrench size={32} />}
            title="No truck assigned"
            description="Ask a manager to assign you a truck before recording parts used."
          />
        </div>
      ) : (
        <>
          <Card className="mt-5 flex flex-col gap-3 p-4">
            {trucks.length > 1 && (
              <div>
                <label htmlFor="use-truck" className="text-sm font-medium text-nexus-navy">
                  Truck
                </label>
                <select
                  id="use-truck"
                  value={truckId}
                  onChange={(e) => {
                    setTruckId(e.target.value);
                    setUsed({});
                  }}
                  className={input}
                >
                  {trucks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="use-job" className="text-sm font-medium text-nexus-navy">
                Job / work order number
              </label>
              <input
                id="use-job"
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
                className={input}
                autoComplete="off"
                inputMode="text"
              />
            </div>
            <div>
              <p className="text-sm font-medium text-nexus-navy">Scan parts as you use them</p>
              <ScannerInput onScan={onScan} placeholder="Scan or type a part code" />
            </div>
          </Card>

          <div role="status" aria-live="polite" className="mt-3 min-h-[1.25rem] text-sm">
            {error && <p className="text-nexus-danger">{error}</p>}
            {notice && <p className="text-nexus-ok">{notice}</p>}
          </div>

          {stock.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                icon={<PackageCheck size={32} />}
                title={`${truck?.label ?? "This truck"} is empty`}
                description="Load parts at Truck checkout first."
              />
            </div>
          ) : (
            <>
              <label htmlFor="use-filter" className="sr-only">
                Filter parts on the truck
              </label>
              <input
                id="use-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter parts on the truck"
                className={`${input} mt-3`}
              />
              <ul className="mt-3 divide-y divide-nexus-line rounded-xl border-2 border-nexus-line bg-white">
                {visible.map((s) => {
                  const q = used[s.part.id] ?? 0;
                  return (
                    <li key={s.part.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-nexus-navy">{s.part.name}</p>
                        <p className="text-xs text-nexus-steel">
                          <span className="font-data">{s.part.sku}</span> · {s.quantity} on truck
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setQty(s.part.id, q - 1)}
                          disabled={q === 0}
                          aria-label={`One fewer ${s.part.name}`}
                          className="tap-target flex w-12 items-center justify-center rounded-lg border-2 border-nexus-line disabled:opacity-30"
                        >
                          <Minus size={18} />
                        </button>
                        <span className="w-10 text-center font-data text-lg" aria-label={`${q} ${s.part.name} used`}>
                          {q}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQty(s.part.id, q + 1)}
                          disabled={q >= s.quantity}
                          aria-label={`One more ${s.part.name}`}
                          className="tap-target flex w-12 items-center justify-center rounded-lg border-2 border-nexus-line disabled:opacity-30"
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <label htmlFor="use-notes" className="mt-4 block text-sm font-medium text-nexus-navy">
                Notes (optional)
              </label>
              <input
                id="use-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                className={input}
              />
            </>
          )}

          <div className="fixed inset-x-0 bottom-0 border-t-2 border-nexus-line bg-white/95 px-4 py-3 md:static md:mt-6 md:border-0 md:bg-transparent md:px-0">
            <Button
              onClick={submit}
              disabled={busy || !jobNumber.trim() || lines.length === 0}
              icon={<PackageCheck size={18} />}
              className="w-full"
            >
              {busy
                ? "Recording…"
                : lines.length === 0
                  ? "Pick the parts you used"
                  : !jobNumber.trim()
                    ? "Enter the job number"
                    : `Record ${totalUnits} ${totalUnits === 1 ? "part" : "parts"} on job ${jobNumber.trim()}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
