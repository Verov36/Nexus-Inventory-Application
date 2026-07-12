"use client";

import { useState } from "react";

type Summary = {
  range: { from: string; to: string };
  totalCheckouts: number;
  jobUseCount: number;
  restockCount: number;
  flaggedOverages: number;
  byTech: { tech: string; partsCheckedOut: number; jobUseCount: number; restockCount: number }[];
  byPart: { part: string; quantity: number }[];
  byJob: { jobNumber: string; parts: { part: string; quantity: number }[] }[];
};

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function ReportsPage() {
  const [range, setRange] = useState(defaultRange());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);

  async function runReport() {
    setBusy(true);
    const res = await fetch(`/api/reports/weekly?from=${range.from}&to=${range.to}`);
    const data = await res.json();
    setSummary(data.summary ?? null);
    setBusy(false);
  }

  function downloadCsv() {
    window.location.href = `/api/reports/weekly?from=${range.from}&to=${range.to}&format=csv`;
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-nexus-paper px-4 pb-24 pt-8">
      <h1 className="text-2xl font-medium text-nexus-navy">Parts usage report</h1>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm text-nexus-steel">From</label>
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
            className="tap-target rounded-lg border-2 border-nexus-steel/30 px-3"
          />
        </div>
        <div>
          <label className="block text-sm text-nexus-steel">To</label>
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
            className="tap-target rounded-lg border-2 border-nexus-steel/30 px-3"
          />
        </div>
        <button onClick={runReport} disabled={busy} className="tap-target rounded-lg bg-nexus-navy px-4 font-medium text-white">
          {busy ? "Running…" : "Run report"}
        </button>
        <button
          onClick={downloadCsv}
          className="tap-target rounded-lg border-2 border-nexus-navy px-4 font-medium text-nexus-navy"
        >
          Download CSV
        </button>
      </div>

      {summary && (
        <div className="mt-6 flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Checkouts" value={summary.totalCheckouts} />
            <Stat label="Job use" value={summary.jobUseCount} />
            <Stat label="Restock" value={summary.restockCount} />
            <Stat label="Flagged overages" value={summary.flaggedOverages} />
          </div>

          <section>
            <h2 className="text-sm font-medium text-nexus-steel">By tech</h2>
            <ul className="mt-2 divide-y divide-nexus-steel/10 rounded-xl border-2 border-nexus-steel/15 bg-white">
              {summary.byTech.map((t, i) => (
                <li key={i} className="flex justify-between px-4 py-2 text-sm">
                  <span>{t.tech}</span>
                  <span>
                    {t.partsCheckedOut} parts ({t.jobUseCount} job, {t.restockCount} restock)
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-sm font-medium text-nexus-steel">By part</h2>
            <ul className="mt-2 divide-y divide-nexus-steel/10 rounded-xl border-2 border-nexus-steel/15 bg-white">
              {summary.byPart.map((p, i) => (
                <li key={i} className="flex justify-between px-4 py-2 text-sm">
                  <span>{p.part}</span>
                  <span>{p.quantity}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-sm font-medium text-nexus-steel">By job</h2>
            <ul className="mt-2 divide-y divide-nexus-steel/10 rounded-xl border-2 border-nexus-steel/15 bg-white">
              {summary.byJob.map((j, i) => (
                <li key={i} className="px-4 py-2 text-sm">
                  <p className="font-medium">{j.jobNumber}</p>
                  <p className="text-nexus-steel">
                    {j.parts.map((p) => `${p.part} ×${p.quantity}`).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border-2 border-nexus-steel/15 bg-white p-4 text-center">
      <p className="text-2xl font-medium text-nexus-navy">{value}</p>
      <p className="text-xs text-nexus-steel">{label}</p>
    </div>
  );
}
