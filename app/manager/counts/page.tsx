"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, ClipboardCheck, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatMoney } from "@/lib/money";

type Status = "OPEN" | "SUBMITTED" | "APPLIED" | "DISCARDED";
type CountRow = {
  id: string;
  status: Status;
  truck: { id: string; label: string; tech: { name: string } | null };
  startedBy: { name: string };
  reviewedBy: { name: string } | null;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  totalLines: number;
  countedLines: number;
  unitsShort: number;
  unitsOver: number;
  varianceValue: number;
};
type Line = {
  id: string;
  partId: string;
  expectedQty: number;
  countedQty: number | null;
  variance: number | null;
  varianceValue: number | null;
  part: { id: string; sku: string; name: string; category: string | null; unitCost: string | number | null };
};
type CountDetail = CountRow & { notes: string | null; lines: Line[] };

export default function CountsPage() {
  return (
    <Suspense fallback={null}>
      <CountsScreen />
    </Suspense>
  );
}

function CountsScreen() {
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<Status | "ALL">("SUBMITTED");
  const [rows, setRows] = useState<CountRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(searchParams.get("open"));
  const [detail, setDetail] = useState<CountDetail | null>(null);
  const [onlyVariances, setOnlyVariances] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const qs = filter === "ALL" ? "" : `?status=${filter}`;
    fetch(`/api/truck-counts${qs}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(typeof d.error === "string" ? d.error : `Couldn't load counts (${r.status}).`);
          return;
        }
        setRows(d.counts ?? []);
      })
      .catch(() => setError("Couldn't reach the server — check your connection."))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    fetch(`/api/truck-counts/${openId}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setError(typeof d.error === "string" ? d.error : `Couldn't load that count (${r.status}).`);
          return;
        }
        setDetail(d.count);
      })
      .catch(() => setError("Couldn't reach the server — check your connection."));
  }, [openId]);

  async function review(decision: "APPLY" | "DISCARD") {
    if (!detail) return;
    if (decision === "DISCARD" && !confirm("Discard this count? Nothing will be adjusted.")) return;
    if (
      decision === "APPLY" &&
      !confirm(
        `Apply this count? ${detail.unitsShort} units will be written off and ${detail.unitsOver} added to ${detail.truck.label}'s stock as count corrections.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/truck-counts/${detail.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : `That didn't go through (${res.status}).`);
        return;
      }
      setNotice(
        decision === "APPLY"
          ? `Applied — ${d.adjustments ?? 0} ${d.adjustments === 1 ? "adjustment" : "adjustments"} posted to ${detail.truck.label}.`
          : "Count discarded."
      );
      setOpenId(null);
      load();
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const visibleLines = detail ? detail.lines.filter((l) => !onlyVariances || (l.variance ?? 0) !== 0) : [];

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6 md:pt-10">
      <PageHeader
        title="Truck counts"
        subtitle="Physical counts submitted by techs. Applying one posts the differences as adjustments."
        actions={
          <Link href="/truck/count">
            <Button variant="secondary" icon={<ClipboardCheck size={16} />}>
              Count a truck
            </Button>
          </Link>
        }
      />

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

      {detail ? (
        <section className="mt-6">
          <button onClick={() => setOpenId(null)} className="text-sm text-nexus-steel underline">
            ← All counts
          </button>
          <Card className="mt-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg font-bold text-nexus-navy">{detail.truck.label}</p>
                <p className="text-sm text-nexus-steel">
                  Counted by {detail.startedBy.name} · started {new Date(detail.createdAt).toLocaleString()}
                  {detail.submittedAt ? ` · submitted ${new Date(detail.submittedAt).toLocaleString()}` : ""}
                </p>
                {detail.notes && <p className="mt-1 text-sm italic text-nexus-steel">&quot;{detail.notes}&quot;</p>}
              </div>
              <StatusBadge status={detail.status} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Lines" value={detail.totalLines} />
              <Stat label="Short" value={detail.unitsShort} tone={detail.unitsShort > 0 ? "danger" : "neutral"} />
              <Stat label="Over" value={detail.unitsOver} tone={detail.unitsOver > 0 ? "warn" : "neutral"} />
              <Stat
                label="Net value"
                value={formatMoney(detail.varianceValue)}
                tone={detail.varianceValue < 0 ? "danger" : detail.varianceValue > 0 ? "warn" : "neutral"}
              />
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm text-nexus-steel">
              <input type="checkbox" checked={onlyVariances} onChange={(e) => setOnlyVariances(e.target.checked)} />
              Only show lines with a difference
            </label>

            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-nexus-steel">
                    <th className="py-1 pr-2 font-medium">Part</th>
                    <th className="py-1 px-2 text-right font-medium">System</th>
                    <th className="py-1 px-2 text-right font-medium">Counted</th>
                    <th className="py-1 px-2 text-right font-medium">Diff</th>
                    <th className="py-1 pl-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-nexus-line">
                  {visibleLines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-1.5 pr-2">
                        <Link href={`/parts/${l.partId}`} className="text-nexus-navy">
                          {l.part.name}
                        </Link>{" "}
                        <span className="font-data text-xs text-nexus-steel">({l.part.sku})</span>
                      </td>
                      <td className="py-1.5 px-2 text-right font-data">{l.expectedQty}</td>
                      <td className="py-1.5 px-2 text-right font-data">{l.countedQty ?? "—"}</td>
                      <td
                        className={`py-1.5 px-2 text-right font-data font-medium ${
                          (l.variance ?? 0) < 0 ? "text-nexus-danger" : (l.variance ?? 0) > 0 ? "text-nexus-warn" : "text-nexus-steel"
                        }`}
                      >
                        {l.variance === null ? "—" : l.variance > 0 ? `+${l.variance}` : l.variance}
                      </td>
                      <td className="py-1.5 pl-2 text-right font-data text-nexus-steel">
                        {l.varianceValue === null || l.varianceValue === 0 ? "" : formatMoney(l.varianceValue)}
                      </td>
                    </tr>
                  ))}
                  {visibleLines.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-3 text-center text-nexus-steel">
                        {onlyVariances ? "No differences — the truck matches the system." : "No lines."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {(detail.status === "SUBMITTED" || detail.status === "OPEN") && (
              <div className="mt-4 flex gap-2">
                <Button onClick={() => review("APPLY")} disabled={busy || detail.countedLines < detail.totalLines} icon={<Check size={16} />} className="flex-1">
                  {busy ? "Working…" : "Apply count"}
                </Button>
                <Button onClick={() => review("DISCARD")} disabled={busy} variant="danger" icon={<Trash2 size={16} />}>
                  Discard
                </Button>
              </div>
            )}
            {detail.status === "OPEN" && detail.countedLines < detail.totalLines && (
              <p className="mt-2 text-xs text-nexus-steel">
                Still being counted ({detail.countedLines}/{detail.totalLines} lines) — it can be applied once every line is entered.
              </p>
            )}
            {detail.reviewedBy && detail.reviewedAt && (
              <p className="mt-3 text-xs text-nexus-steel">
                {detail.status === "APPLIED" ? "Applied" : "Discarded"} by {detail.reviewedBy.name} on{" "}
                {new Date(detail.reviewedAt).toLocaleString()}
              </p>
            )}
          </Card>
        </section>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["SUBMITTED", "OPEN", "APPLIED", "DISCARDED", "ALL"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`tap-target rounded-lg px-4 text-sm font-medium ${
                  filter === s ? "bg-nexus-navy text-white" : "border-2 border-nexus-line bg-white text-nexus-navy"
                }`}
              >
                {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          {loading && <p className="mt-6 text-nexus-steel">Loading…</p>}

          {!loading && rows.length === 0 && (
            <div className="mt-6">
              <EmptyState
                icon={<ClipboardCheck size={32} />}
                title={filter === "SUBMITTED" ? "Nothing waiting for review" : "No counts here"}
                description="Techs submit counts from the Truck count screen; you can also count any truck yourself."
              />
            </div>
          )}

          <ul className="mt-4 flex flex-col gap-2">
            {rows.map((c) => (
              <Card key={c.id} as="li" accent={c.status === "SUBMITTED" ? "warn" : c.status === "APPLIED" ? "ok" : "none"}>
                <button onClick={() => setOpenId(c.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                  <div className="min-w-0">
                    <p className="font-medium text-nexus-navy">
                      {c.truck.label}
                      {c.truck.tech ? <span className="ml-2 text-sm font-normal text-nexus-steel">{c.truck.tech.name}</span> : null}
                    </p>
                    <p className="text-xs text-nexus-steel">
                      {c.startedBy.name} · {new Date(c.submittedAt ?? c.createdAt).toLocaleString()} · {c.countedLines}/{c.totalLines} lines
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={c.status} />
                    {(c.unitsShort > 0 || c.unitsOver > 0) && (
                      <p className="mt-1 font-data text-xs text-nexus-steel">
                        {c.unitsShort > 0 ? `-${c.unitsShort}` : ""}
                        {c.unitsShort > 0 && c.unitsOver > 0 ? " / " : ""}
                        {c.unitsOver > 0 ? `+${c.unitsOver}` : ""} · {formatMoney(c.varianceValue)}
                      </p>
                    )}
                  </div>
                </button>
              </Card>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const tone =
    status === "SUBMITTED"
      ? "bg-nexus-warn/10 text-nexus-warn"
      : status === "APPLIED"
        ? "bg-nexus-ok/10 text-nexus-ok"
        : status === "OPEN"
          ? "bg-nexus-navy/10 text-nexus-navy"
          : "bg-nexus-steel/10 text-nexus-steel";
  const label = status === "SUBMITTED" ? "Needs review" : status.charAt(0) + status.slice(1).toLowerCase();
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{label}</span>;
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: number | string; tone?: "neutral" | "danger" | "warn" }) {
  const color = tone === "danger" ? "text-nexus-danger" : tone === "warn" ? "text-nexus-warn" : "text-nexus-navy";
  return (
    <div className="rounded-xl border-2 border-nexus-steel/15 bg-white p-3 text-center">
      <p className={`font-data text-xl font-semibold ${color}`}>{value}</p>
      <p className="text-xs text-nexus-steel">{label}</p>
    </div>
  );
}
