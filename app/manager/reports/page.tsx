"use client";

import { useEffect, useState } from "react";

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

type Schedule = { id: string; frequencyDays: number; lastRunAt: string | null; nextRunAt: string };
type Snapshot = { id: string; rangeFrom: string; rangeTo: string; generatedAt: string; summary: Summary };

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
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [frequencyInput, setFrequencyInput] = useState("7");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  useEffect(() => {
    fetch("/api/report-schedule")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.schedule) {
          setSchedule(d.schedule);
          setFrequencyInput(String(d.schedule.frequencyDays));
        }
      });
    fetch("/api/reports/snapshots")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSnapshots(d?.snapshots ?? []));
  }, []);

  async function saveFrequency() {
    const res = await fetch("/api/report-schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frequencyDays: Number(frequencyInput) }),
    });
    if (res.ok) {
      const data = await res.json();
      setSchedule(data.schedule);
    }
  }

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

      <section className="mt-4 rounded-xl border-2 border-nexus-steel/15 bg-white p-4">
        <p className="font-medium text-nexus-navy">Audit report schedule</p>
        <p className="mt-1 text-sm text-nexus-steel">
          Runs automatically on this cadence and saves a snapshot below. Loosen it up once inventory
          settles into a manageable rhythm.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-nexus-steel">Every</span>
          <input
            type="number"
            min={1}
            max={90}
            value={frequencyInput}
            onChange={(e) => setFrequencyInput(e.target.value)}
            className="tap-target w-20 rounded-lg border-2 border-nexus-steel/30 px-3"
          />
          <span className="text-sm text-nexus-steel">days</span>
          <button
            onClick={saveFrequency}
            className="tap-target rounded-lg border-2 border-nexus-navy px-4 text-sm font-medium text-nexus-navy"
          >
            Save
          </button>
          {schedule?.nextRunAt && (
            <span className="text-xs text-nexus-steel">
              Next run: {new Date(schedule.nextRunAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </section>

      {snapshots.length > 0 && (
        <section className="mt-4 rounded-xl border-2 border-nexus-steel/15 bg-white p-4">
          <p className="font-medium text-nexus-navy">Past automated reports</p>
          <ul className="mt-2 divide-y divide-nexus-steel/10 text-sm">
            {snapshots.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span>
                  {new Date(s.rangeFrom).toLocaleDateString()} – {new Date(s.rangeTo).toLocaleDateString()}
                </span>
                <button
                  onClick={() => {
                    setSummary(s.summary);
                    setRange({
                      from: s.rangeFrom.slice(0, 10),
                      to: s.rangeTo.slice(0, 10),
                    });
                  }}
                  className="text-nexus-navy underline"
                >
                  View
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}


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
