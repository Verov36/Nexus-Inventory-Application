"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ClipboardCheck, Search, Send, Trash2, Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { canManageTrucksAndLimits } from "@/lib/roles";

type TruckOption = { id: string; label: string; active: boolean; techId: string | null };
type Line = {
  id: string;
  partId: string;
  expectedQty: number | null;
  countedQty: number | null;
  part: { id: string; sku: string; name: string; category: string | null };
};
type Count = {
  id: string;
  status: "OPEN" | "SUBMITTED" | "APPLIED" | "DISCARDED";
  notes: string | null;
  createdAt: string;
  truck: { id: string; label: string };
  lines: Line[];
  totalLines: number;
  countedLines: number;
};
type PartOption = { id: string; sku: string; name: string; category: string | null };

const REMEMBERED_TRUCK_KEY = "nexus-inventory:selected-truck-id";
const UNCATEGORIZED = "Uncategorized";

export default function TruckCountPage() {
  return (
    <Suspense fallback={null}>
      <TruckCountScreen />
    </Suspense>
  );
}

function TruckCountScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isManager = canManageTrucksAndLimits(role);

  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [truckId, setTruckId] = useState(searchParams.get("truckId") ?? "");
  const [count, setCount] = useState<Count | null>(null);
  const [pendingReview, setPendingReview] = useState<Count | null>(null);
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PartOption[]>([]);
  const [done, setDone] = useState<{ counted: number } | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/trucks")
      .then((r) => (r.ok ? r.json() : { trucks: [] }))
      .then((d) => {
        const active: TruckOption[] = (d.trucks ?? []).filter((t: { active: boolean }) => t.active);
        setTrucks(active);
        if (!truckId) {
          let remembered: string | null = null;
          try {
            remembered = localStorage.getItem(REMEMBERED_TRUCK_KEY);
          } catch {
            /* ignore */
          }
          if (remembered && active.some((t) => t.id === remembered)) setTruckId(remembered);
          else if (active.length === 1) setTruckId(active[0].id);
        }
      })
      .catch(() => setError("Couldn't load the truck list — check your connection."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrate = useCallback((c: Count) => {
    setCount(c);
    setNotes(c.notes ?? "");
    setEntries(Object.fromEntries(c.lines.map((l) => [l.partId, l.countedQty === null ? "" : String(l.countedQty)])));
  }, []);

  // Find an in-progress count for the chosen truck.
  useEffect(() => {
    setCount(null);
    setPendingReview(null);
    setDone(null);
    if (!truckId) return;
    fetch(`/api/truck-counts?truckId=${encodeURIComponent(truckId)}&status=OPEN,SUBMITTED`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return;
        const open = (d.counts ?? []).find((c: Count) => c.status === "OPEN");
        const submitted = (d.counts ?? []).find((c: Count) => c.status === "SUBMITTED");
        if (open) {
          const full = await fetch(`/api/truck-counts/${open.id}`).then((x) => x.json());
          if (full.count) hydrate(full.count);
        } else if (submitted) {
          setPendingReview(submitted);
        }
      })
      .catch(() => {});
  }, [truckId, hydrate]);

  async function startCount() {
    if (!truckId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/truck-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ truckId }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && d.count?.status === "OPEN") {
        const full = await fetch(`/api/truck-counts/${d.count.id}`).then((x) => x.json());
        if (full.count) hydrate(full.count);
        return;
      }
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : `Couldn't start the count (${res.status}).`);
        return;
      }
      hydrate(d.count);
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  // Debounced autosave of whatever has been typed, so a dropped connection
  // or a closed tab mid-count doesn't lose the work.
  const scheduleSave = useCallback(
    (next: Record<string, string>, nextNotes: string) => {
      if (!count) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        setSaving(true);
        try {
          const lines = Object.entries(next).map(([partId, v]) => ({
            partId,
            countedQty: v.trim() === "" ? null : Math.max(0, Math.floor(Number(v))),
          }));
          const res = await fetch(`/api/truck-counts/${count.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lines: lines.filter((l) => l.countedQty === null || Number.isFinite(l.countedQty)), notes: nextNotes }),
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            setError(typeof d.error === "string" ? d.error : `Couldn't save (${res.status}).`);
          } else {
            setError(null);
          }
        } catch {
          setError("Couldn't save — check your connection. Your entries are still on screen.");
        } finally {
          setSaving(false);
        }
      }, 600);
    },
    [count]
  );

  function setEntry(partId: string, value: string) {
    setEntries((prev) => {
      const next = { ...prev, [partId]: value };
      scheduleSave(next, notes);
      return next;
    });
  }

  function setNotesText(value: string) {
    setNotes(value);
    scheduleSave(entries, value);
  }

  async function searchParts(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/parts/search?q=${encodeURIComponent(q)}`);
      const d = await res.json().catch(() => ({}));
      setResults(res.ok ? (d.parts ?? []).filter((p: PartOption) => !count?.lines.some((l) => l.partId === p.id)) : []);
    } catch {
      setResults([]);
    }
  }

  async function addPart(part: PartOption) {
    if (!count) return;
    setError(null);
    try {
      const res = await fetch(`/api/truck-counts/${count.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addPartId: part.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : `Couldn't add that part (${res.status}).`);
        return;
      }
      hydrate(d.count);
      setEntries((prev) => ({ ...prev, [part.id]: "1" }));
      scheduleSave({ ...entries, [part.id]: "1" }, notes);
      setQuery("");
      setResults([]);
    } catch {
      setError("Couldn't reach the server — check your connection.");
    }
  }

  const uncounted = useMemo(
    () => (count ? count.lines.filter((l) => (entries[l.partId] ?? "").trim() === "").length : 0),
    [count, entries]
  );

  async function submit() {
    if (!count) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setBusy(true);
    setError(null);
    try {
      // Flush any pending edits first.
      const lines = Object.entries(entries).map(([partId, v]) => ({
        partId,
        countedQty: v.trim() === "" ? null : Math.max(0, Math.floor(Number(v))),
      }));
      const save = await fetch(`/api/truck-counts/${count.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, notes }),
      });
      if (!save.ok) {
        const d = await save.json().catch(() => ({}));
        setError(typeof d.error === "string" ? d.error : `Couldn't save before submitting (${save.status}).`);
        return;
      }
      const res = await fetch(`/api/truck-counts/${count.id}/submit`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : `Couldn't submit (${res.status}).`);
        return;
      }
      setDone({ counted: count.lines.length });
      setCount(null);
      if (isManager) router.push(`/manager/counts?open=${count.id}`);
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!count) return;
    if (!confirm("Throw away this count? Everything entered so far will be lost.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/truck-counts/${count.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "DISCARD" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(typeof d.error === "string" ? d.error : `Couldn't discard (${res.status}).`);
        return;
      }
      setCount(null);
      setNotice("Count discarded.");
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    if (!count) return [] as [string, Line[]][];
    const map = new Map<string, Line[]>();
    for (const l of count.lines) {
      const key = l.part.category?.trim() || UNCATEGORIZED;
      map.set(key, [...(map.get(key) ?? []), l]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === UNCATEGORIZED) return 1;
      if (b === UNCATEGORIZED) return -1;
      return a.localeCompare(b);
    });
  }, [count]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-6 md:pt-10">
      <PageHeader
        title="Truck count"
        subtitle="Count what's physically on the truck. Enter 0 for anything that's gone."
      />

      <select
        value={truckId}
        onChange={(e) => setTruckId(e.target.value)}
        disabled={!!count}
        className="tap-target mt-4 w-full rounded-lg border-2 border-nexus-line bg-white px-4 text-sm disabled:opacity-60"
      >
        <option value="">Select a truck…</option>
        {trucks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      {error && (
        <Card accent="danger" className="mt-4 p-3">
          <p className="text-sm text-nexus-danger">{error}</p>
        </Card>
      )}
      {notice && (
        <Card accent="ok" className="mt-4 p-3">
          <p className="text-sm text-nexus-ok">{notice}</p>
        </Card>
      )}

      {done && (
        <Card accent="ok" className="mt-6 p-4">
          <p className="flex items-center gap-2 font-medium text-nexus-ok">
            <ClipboardCheck size={18} /> Count submitted
          </p>
          <p className="mt-1 text-sm text-nexus-steel">
            {done.counted} lines sent to a manager to review. Any differences get posted once they apply it.
          </p>
        </Card>
      )}

      {truckId && !count && pendingReview && !done && (
        <Card accent="warn" className="mt-6 p-4">
          <p className="font-medium text-nexus-warn">A count from {new Date(pendingReview.createdAt).toLocaleDateString()} is waiting for review</p>
          <p className="mt-1 text-sm text-nexus-steel">
            A manager needs to apply or discard it before a new count can start.
            {isManager && (
              <>
                {" "}
                <button onClick={() => router.push(`/manager/counts?open=${pendingReview.id}`)} className="underline">
                  Review it now.
                </button>
              </>
            )}
          </p>
        </Card>
      )}

      {truckId && !count && !pendingReview && !done && (
        <div className="mt-6">
          <EmptyState
            icon={<ClipboardCheck size={32} />}
            title="No count in progress"
            description="Starting a count lists every part the system has on this truck. You'll enter what you actually find — the expected numbers stay hidden until you submit."
            action={
              <Button onClick={startCount} disabled={busy} icon={<ClipboardCheck size={16} />}>
                {busy ? "Starting…" : "Start count"}
              </Button>
            }
          />
        </div>
      )}

      {count && (
        <>
          <div className="mt-4 flex items-center justify-between text-sm text-nexus-steel">
            <span>
              Started {new Date(count.createdAt).toLocaleString()} · {count.lines.length - uncounted}/{count.lines.length} counted
            </span>
            <span className="text-xs">{saving ? "Saving…" : "Saved"}</span>
          </div>

          {count.lines.length === 0 && (
            <p className="mt-4 text-sm text-nexus-steel">
              The system shows nothing on this truck. If there are parts on it, add them below.
            </p>
          )}

          {grouped.map(([category, lines]) => (
            <section key={category} className="mt-4">
              <h2 className="text-xs font-medium uppercase tracking-wide text-nexus-steel">{category}</h2>
              <ul className="mt-1 flex flex-col gap-1.5">
                {lines.map((l) => {
                  const value = entries[l.partId] ?? "";
                  const blank = value.trim() === "";
                  return (
                    <Card key={l.id} as="li" accent={blank ? "warn" : "ok"} className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-nexus-navy">{l.part.name}</p>
                          <p className="font-data text-xs text-nexus-steel">
                            {l.part.sku}
                            {isManager && l.expectedQty !== null ? ` · system says ${l.expectedQty}` : ""}
                          </p>
                        </div>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          placeholder="—"
                          value={value}
                          onChange={(e) => setEntry(l.partId, e.target.value)}
                          className="tap-target w-20 rounded-lg border-2 border-nexus-line px-2 text-center font-data text-lg"
                        />
                      </div>
                    </Card>
                  );
                })}
              </ul>
            </section>
          ))}

          <section className="mt-6">
            <h2 className="text-xs font-medium uppercase tracking-wide text-nexus-steel">Found something not listed?</h2>
            <div className="relative mt-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nexus-steelfaint" />
              <input
                value={query}
                onChange={(e) => searchParts(e.target.value)}
                placeholder="Search by name or SKU to add it"
                className="tap-target w-full rounded-lg border-2 border-nexus-line bg-white pl-9 pr-4"
              />
              {results.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border-2 border-nexus-line bg-white shadow-lg">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => addPart(p)}
                        className="tap-target flex w-full items-center justify-between px-3 text-left text-sm hover:bg-nexus-paper"
                      >
                        <span>
                          {p.name} <span className="font-data text-xs text-nexus-steel">({p.sku})</span>
                        </span>
                        <Plus size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <label className="mt-6 block text-xs font-medium uppercase tracking-wide text-nexus-steel">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotesText(e.target.value)}
            rows={2}
            placeholder="e.g. box of fittings damaged, two lengths of pipe on the roof rack"
            className="mt-1 w-full rounded-lg border-2 border-nexus-line p-3 text-sm"
          />

          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-nexus-line bg-white/95 px-4 py-3 backdrop-blur md:left-64">
            <div className="mx-auto flex max-w-2xl items-center gap-3">
              <div className="min-w-0 flex-1 text-sm text-nexus-steel">
                {uncounted > 0 ? (
                  <span className="text-nexus-warn">
                    {uncounted} {uncounted === 1 ? "line" : "lines"} still blank — enter 0 if none are on the truck.
                  </span>
                ) : (
                  <span>All {count.lines.length} lines counted.</span>
                )}
              </div>
              <Button variant="ghost" onClick={discard} disabled={busy} icon={<Trash2 size={16} />}>
                Discard
              </Button>
              <Button onClick={submit} disabled={busy || uncounted > 0} icon={<Send size={16} />}>
                {busy ? "Submitting…" : isManager ? "Submit & review" : "Submit count"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
