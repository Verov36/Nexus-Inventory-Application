"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ScannerInput from "@/components/ScannerInput";
import { Wrench, PackageCheck, AlertTriangle, Send, X, Plus, Minus, Trash2, Search, History } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";

type Part = { id: string; sku: string; name: string; category: string | null; barcodeValue: string };
type RecentPart = Part & { truckQty: number; cap: number | null };
type TruckOption = { id: string; label: string; active: boolean };
type CartLine = { part: Part; quantity: number };
type JobOption = { id: string; jobNumber: string; customer: string | null };
type OverCapLine = { partId: string; name: string; sku: string; currentTruckQty: number; projectedQty: number; limit: number };

const DEFAULT_WAREHOUSE_ID = process.env.NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID ?? "";
const REMEMBERED_TRUCK_KEY = "nexus-inventory:selected-truck-id";

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export default function TruckCheckoutPage() {
  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [trucksLoaded, setTrucksLoaded] = useState(false);
  const [truckId, setTruckId] = useState("");

  const [checkoutType, setCheckoutType] = useState<"JOB_USE" | "RESTOCK">("JOB_USE");
  const [jobNumber, setJobNumber] = useState("");
  const [jobOptions, setJobOptions] = useState<JobOption[]>([]);
  const [showJobOptions, setShowJobOptions] = useState(false);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [recent, setRecent] = useState<RecentPart[]>([]);
  const [searchResults, setSearchResults] = useState<Part[] | null>(null);
  const [lastScan, setLastScan] = useState<string | null>(null);

  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"neutral" | "error" | "success">("neutral");
  const [busy, setBusy] = useState(false);

  const [overCap, setOverCap] = useState<{ lines: OverCapLine[]; message: string } | null>(null);
  const [explanation, setExplanation] = useState("");
  const [relatedJobNumbers, setRelatedJobNumbers] = useState("");

  const jobBlurTimer = useRef<number | null>(null);

  // ---- trucks ------------------------------------------------------------

  useEffect(() => {
    fetch("/api/trucks")
      .then((r) => (r.ok ? r.json() : { trucks: [] }))
      .then((d) => {
        const active: TruckOption[] = (d.trucks ?? []).filter((t: { active: boolean }) => t.active);
        setTrucks(active);
        let remembered: string | null = null;
        try {
          remembered = localStorage.getItem(REMEMBERED_TRUCK_KEY);
        } catch {
          /* storage blocked */
        }
        if (remembered && active.some((t) => t.id === remembered)) setTruckId(remembered);
        else if (active.length === 1) setTruckId(active[0].id);
      })
      .catch(() => {
        setStatusTone("error");
        setStatus("Couldn't load the truck list — check your connection and reload.");
      })
      .finally(() => setTrucksLoaded(true));
  }, []);

  const loadRecent = useCallback((id: string) => {
    if (!id) {
      setRecent([]);
      return;
    }
    fetch(`/api/trucks/${id}/recent-parts`)
      .then((r) => (r.ok ? r.json() : { parts: [] }))
      .then((d) => setRecent(d.parts ?? []))
      .catch(() => setRecent([]));
  }, []);

  useEffect(() => {
    loadRecent(truckId);
  }, [truckId, loadRecent]);

  function handleTruckChange(id: string) {
    setTruckId(id);
    try {
      if (id) localStorage.setItem(REMEMBERED_TRUCK_KEY, id);
    } catch {
      /* ignore */
    }
  }

  // ---- jobs --------------------------------------------------------------

  async function fetchJobs(q: string) {
    try {
      const res = await fetch(`/api/jobs?q=${encodeURIComponent(q)}`);
      const d = await safeJson(res);
      setJobOptions(res.ok ? ((d.jobs as JobOption[]) ?? []) : []);
    } catch {
      setJobOptions([]);
    }
  }

  function onJobFocus() {
    if (jobBlurTimer.current) window.clearTimeout(jobBlurTimer.current);
    setShowJobOptions(true);
    fetchJobs(jobNumber.trim());
  }

  function onJobBlur() {
    // Let a click on a suggestion land before the list disappears.
    jobBlurTimer.current = window.setTimeout(() => setShowJobOptions(false), 150);
  }

  // ---- cart --------------------------------------------------------------

  function addToCart(part: Part, quantity = 1) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.part.id === part.id);
      if (idx === -1) return [...prev, { part, quantity }];
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
      return next;
    });
    setSearchResults(null);
    setLastScan(null);
    setOverCap(null);
    setStatus(null);
  }

  function setLineQuantity(partId: string, quantity: number) {
    setCart((prev) => prev.map((l) => (l.part.id === partId ? { ...l, quantity: Math.max(0, quantity) } : l)));
  }

  function removeLine(partId: string) {
    setCart((prev) => prev.filter((l) => l.part.id !== partId));
  }

  const totalUnits = cart.reduce((sum, l) => sum + l.quantity, 0);
  const cartValid = cart.length > 0 && cart.every((l) => Number.isInteger(l.quantity) && l.quantity >= 1);

  // ---- scanning / searching ---------------------------------------------

  async function handleScan(value: string) {
    setStatus(null);
    setOverCap(null);
    setSearchResults(null);
    try {
      const res = await fetch(`/api/parts?barcode=${encodeURIComponent(value)}`);
      const data = await safeJson(res);
      if (res.ok && data.part) {
        addToCart(data.part as Part);
        return;
      }
      if (!res.ok) {
        setStatusTone("error");
        setStatus(typeof data.error === "string" ? data.error : `Couldn't look up that code (${res.status}).`);
        return;
      }
      // No label match — treat what was typed as a name/SKU search so a
      // missing or unreadable label doesn't stop the checkout.
      const search = await fetch(`/api/parts/search?q=${encodeURIComponent(value)}`);
      const sd = await safeJson(search);
      const parts = search.ok ? ((sd.parts as Part[]) ?? []) : [];
      setLastScan(value);
      if (parts.length === 0) {
        setStatusTone("error");
        setStatus(`Nothing matches "${value}" — no label with that code and no part name or SKU like it. Check with the warehouse.`);
      } else {
        setSearchResults(parts);
      }
    } catch {
      setStatusTone("error");
      setStatus("Couldn't reach the server — check your connection and try again.");
    }
  }

  // ---- submit ------------------------------------------------------------

  async function submitCheckout(withJustification = false) {
    if (!truckId || !cartValid) return;
    setBusy(true);
    setStatus(null);

    const body: Record<string, unknown> = {
      truckId,
      warehouseId: DEFAULT_WAREHOUSE_ID || undefined,
      checkoutType,
      jobNumber: checkoutType === "JOB_USE" ? jobNumber.trim() : undefined,
      items: cart.map((l) => ({ partId: l.part.id, quantity: l.quantity })),
    };
    if (withJustification) {
      body.justification = {
        explanation: explanation.trim(),
        relatedJobNumbers: relatedJobNumbers.split(",").map((s) => s.trim()).filter(Boolean),
      };
    }

    try {
      const res = await fetch("/api/inventory/checkout/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await safeJson(res);
      setBusy(false);

      if (res.status === 409 && data.requiresJustification) {
        setOverCap({
          lines: (data.overCap as OverCapLine[]) ?? [],
          message: typeof data.message === "string" ? data.message : "This truck would go over its cap.",
        });
        return;
      }
      if (!res.ok) {
        setStatusTone("error");
        setStatus(
          typeof data.error === "string"
            ? data.error
            : `Checkout failed (${res.status}). Nothing was moved — try again, and tell a manager if it keeps happening.`
        );
        return;
      }

      const summary = cart.map((l) => `${l.quantity} × ${l.part.name}`).join(", ");
      setStatusTone("success");
      setStatus(
        `Checked out ${totalUnits} ${totalUnits === 1 ? "unit" : "units"} to the truck${
          checkoutType === "JOB_USE" ? ` for job ${jobNumber.trim()}` : ""
        }: ${summary}.`
      );
      setCart([]);
      setJobNumber("");
      setOverCap(null);
      setExplanation("");
      setRelatedJobNumbers("");
      loadRecent(truckId);
    } catch {
      setBusy(false);
      setStatusTone("error");
      setStatus("Couldn't reach the server — check your connection. Nothing was checked out.");
    }
  }

  function cancelJustification() {
    setOverCap(null);
    setExplanation("");
    setRelatedJobNumbers("");
  }

  const jobMissing = checkoutType === "JOB_USE" && !jobNumber.trim();

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-6 md:pt-10">
      <PageHeader title="Truck checkout" subtitle="Scan or tap parts to build a load, then check it all out at once." />

      <select
        value={truckId}
        onChange={(e) => handleTruckChange(e.target.value)}
        className="tap-target mt-4 w-full rounded-lg border-2 border-nexus-line bg-white px-4 text-sm"
      >
        <option value="">Select your truck…</option>
        {trucks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      {trucksLoaded && trucks.length === 0 && (
        <p className="mt-2 text-sm text-nexus-steel">
          No truck is assigned to you yet — a manager needs to add one and assign you to it under Manage trucks.
        </p>
      )}

      {/* Job vs restock, applies to the whole cart */}
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setCheckoutType("JOB_USE")}
          className={`tap-target flex flex-1 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ${
            checkoutType === "JOB_USE" ? "bg-nexus-navy text-white" : "border-2 border-nexus-line bg-white text-nexus-navy"
          }`}
        >
          <Wrench size={16} /> For a job
        </button>
        <button
          onClick={() => setCheckoutType("RESTOCK")}
          className={`tap-target flex flex-1 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors ${
            checkoutType === "RESTOCK" ? "bg-nexus-navy text-white" : "border-2 border-nexus-line bg-white text-nexus-navy"
          }`}
        >
          <PackageCheck size={16} /> Truck restock
        </button>
      </div>

      {checkoutType === "JOB_USE" && (
        <div className="relative mt-3">
          <input
            value={jobNumber}
            onChange={(e) => {
              setJobNumber(e.target.value);
              setShowJobOptions(true);
              fetchJobs(e.target.value.trim());
            }}
            onFocus={onJobFocus}
            onBlur={onJobBlur}
            placeholder="Job / work order number"
            autoComplete="off"
            className="tap-target w-full rounded-lg border-2 border-nexus-line bg-white px-4 font-data"
          />
          {showJobOptions && jobOptions.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border-2 border-nexus-line bg-white shadow-lg">
              {jobOptions.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setJobNumber(j.jobNumber);
                      setShowJobOptions(false);
                    }}
                    className="tap-target flex w-full items-center justify-between px-4 text-left text-sm hover:bg-nexus-paper"
                  >
                    <span className="font-data">{j.jobNumber}</span>
                    {j.customer && <span className="text-xs text-nexus-steel">{j.customer}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-nexus-steel">Recent open jobs appear as you type. A new number creates the job.</p>
        </div>
      )}

      <div className="mt-4">
        <ScannerInput onScan={handleScan} placeholder="Scan a label, or type a name / SKU" />
      </div>

      {status && (
        <p
          className={`mt-3 text-sm ${
            statusTone === "error" ? "text-nexus-danger" : statusTone === "success" ? "text-nexus-ok" : "text-nexus-steel"
          }`}
        >
          {status}
        </p>
      )}

      {searchResults && searchResults.length > 0 && (
        <Card accent="warn" className="mt-3 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-nexus-navy">
            <Search size={16} /> No label matches &quot;{lastScan}&quot; — did you mean:
          </p>
          <ul className="mt-2 divide-y divide-nexus-line">
            {searchResults.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => addToCart(p)}
                  className="tap-target flex w-full items-center justify-between text-left text-sm"
                >
                  <span>
                    {p.name} <span className="font-data text-xs text-nexus-steel">({p.sku})</span>
                  </span>
                  <Plus size={16} className="text-nexus-navy" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Recent parts on this truck */}
      {truckId && recent.length > 0 && (
        <section className="mt-5">
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-nexus-steel">
            <History size={14} /> Usual parts on this truck — tap to add
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {recent.map((p) => {
              const inCart = cart.find((l) => l.part.id === p.id)?.quantity ?? 0;
              const atCap = p.cap !== null && p.truckQty + inCart >= p.cap;
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  title={p.sku}
                  className={`tap-target rounded-lg border-2 px-3 text-left text-sm ${
                    inCart > 0 ? "border-nexus-navy bg-nexus-navy/5" : "border-nexus-line bg-white"
                  }`}
                >
                  <span className="block max-w-[11rem] truncate font-medium text-nexus-navy">{p.name}</span>
                  <span className={`font-data text-xs ${atCap ? "text-nexus-warn" : "text-nexus-steel"}`}>
                    on truck {p.truckQty}
                    {p.cap !== null ? `/${p.cap}` : ""}
                    {inCart > 0 ? ` · +${inCart}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Cart */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-bold text-nexus-navy">Load</h2>
          {cart.length > 0 && (
            <span className="text-sm text-nexus-steel">
              {cart.length} {cart.length === 1 ? "part" : "parts"} · {totalUnits} units
            </span>
          )}
        </div>

        {cart.length === 0 && (
          <p className="mt-2 rounded-xl border-2 border-dashed border-nexus-steel/25 bg-white/50 px-4 py-6 text-center text-sm text-nexus-steel">
            Nothing loaded yet. Scan a label or tap a usual part above.
          </p>
        )}

        {cart.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {cart.map((line) => {
              const hint = recent.find((r) => r.id === line.part.id);
              const projected = hint ? hint.truckQty + line.quantity : null;
              const overHint = hint && hint.cap !== null && projected !== null && projected > hint.cap;
              const invalid = !Number.isInteger(line.quantity) || line.quantity < 1;
              return (
                <Card key={line.part.id} as="li" accent={overHint ? "warn" : "none"} className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-nexus-navy">{line.part.name}</p>
                      <p className="font-data text-xs text-nexus-steel">
                        {line.part.sku}
                        {hint && (
                          <>
                            {" · "}on truck {hint.truckQty}
                            {hint.cap !== null ? `/${hint.cap}` : ""}
                            {overHint ? " · over cap" : ""}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setLineQuantity(line.part.id, line.quantity - 1)}
                        aria-label="Decrease"
                        className="tap-target w-11 rounded-lg border-2 border-nexus-line text-nexus-navy"
                      >
                        <Minus size={16} className="mx-auto" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        value={Number.isNaN(line.quantity) ? "" : line.quantity}
                        onChange={(e) => setLineQuantity(line.part.id, e.target.valueAsNumber)}
                        onBlur={() => {
                          if (invalid) setLineQuantity(line.part.id, 1);
                        }}
                        aria-label="Quantity"
                        className={`tap-target w-16 rounded-lg border-2 px-1 text-center font-data text-lg ${
                          invalid ? "border-nexus-danger" : "border-nexus-line"
                        }`}
                      />
                      <button
                        onClick={() => setLineQuantity(line.part.id, line.quantity + 1)}
                        aria-label="Increase"
                        className="tap-target w-11 rounded-lg border-2 border-nexus-line text-nexus-navy"
                      >
                        <Plus size={16} className="mx-auto" />
                      </button>
                      <button
                        onClick={() => removeLine(line.part.id)}
                        aria-label="Remove"
                        className="tap-target w-11 rounded-lg text-nexus-steel hover:text-nexus-danger"
                      >
                        <Trash2 size={16} className="mx-auto" />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </ul>
        )}
      </section>

      {overCap && (
        <Card accent="warn" className="mt-6 p-4">
          <p className="flex items-center gap-2 font-medium text-nexus-warn">
            <AlertTriangle size={18} /> Truck would go over its stock cap
          </p>
          <p className="mt-1 text-sm text-nexus-steel">{overCap.message}</p>
          {overCap.lines.length > 1 && (
            <ul className="mt-2 text-sm text-nexus-steel">
              {overCap.lines.map((l) => (
                <li key={l.partId}>
                  {l.name}: {l.currentTruckQty} on truck now, {l.projectedQty} after this load, cap {l.limit}
                </li>
              ))}
            </ul>
          )}

          <label className="mt-4 block text-sm text-nexus-steel">
            Why is the truck carrying this much? What&apos;s it accounted for on?
          </label>
          <textarea
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border-2 border-nexus-line p-3"
          />

          <label className="mt-3 block text-sm text-nexus-steel">Related work order numbers (comma separated)</label>
          <input
            value={relatedJobNumbers}
            onChange={(e) => setRelatedJobNumbers(e.target.value)}
            className="tap-target mt-1 w-full rounded-lg border-2 border-nexus-line px-4 font-data"
          />

          <div className="mt-4 flex gap-2">
            <Button
              onClick={() => submitCheckout(true)}
              disabled={busy || !explanation.trim() || !relatedJobNumbers.trim()}
              className="flex-1 !bg-nexus-warn hover:!bg-nexus-warn/90"
              icon={<Send size={16} />}
            >
              {busy ? "Submitting…" : "Submit and check out"}
            </Button>
            <Button onClick={cancelJustification} variant="secondary" icon={<X size={16} />}>
              Cancel
            </Button>
          </div>
          <p className="mt-2 text-xs text-nexus-steel">
            The whole load goes through now; the over-cap parts are flagged for a manager to review.
          </p>
        </Card>
      )}

      {/* Sticky submit bar */}
      {cart.length > 0 && !overCap && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-nexus-line bg-white/95 px-4 py-3 backdrop-blur md:left-64">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="min-w-0 flex-1 text-sm text-nexus-steel">
              {!truckId ? (
                <span className="text-nexus-warn">Select your truck first.</span>
              ) : jobMissing ? (
                <span className="text-nexus-warn">Enter the job number.</span>
              ) : !cartValid ? (
                <span className="text-nexus-warn">Fix the quantities marked in red.</span>
              ) : (
                <span>
                  {totalUnits} {totalUnits === 1 ? "unit" : "units"} →{" "}
                  {trucks.find((t) => t.id === truckId)?.label ?? "truck"}
                  {checkoutType === "JOB_USE" ? ` · job ${jobNumber.trim()}` : " · restock"}
                </span>
              )}
            </div>
            <Button
              onClick={() => submitCheckout(false)}
              disabled={busy || !truckId || jobMissing || !cartValid}
              className="flex-shrink-0"
            >
              {busy ? "Checking out…" : `Check out ${cart.length} ${cart.length === 1 ? "part" : "parts"}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
