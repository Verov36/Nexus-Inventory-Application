"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";

type ImportResults = { created: number; updated: number; skipped: { line: number; reason: string }[] };

export default function ImportPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const [csvText, setCsvText] = useState("");
  const [results, setResults] = useState<ImportResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (role && role !== "SUPER_ADMIN") {
    return (
      <main className="mx-auto min-h-screen max-w-xl bg-nexus-paper px-4 pt-8">
        <p className="text-nexus-danger">Mass import is restricted to the super admin account.</p>
      </main>
    );
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    setResults(null);
    const res = await fetch("/api/admin/import-parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: csvText }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Import failed.");
      return;
    }
    setResults(data.results);
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-nexus-paper px-4 pb-24 pt-8">
      <h1 className="text-2xl font-medium text-nexus-navy">Mass import parts</h1>
      <p className="mt-1 text-nexus-steel">Super admin only. Bulk load or update the parts catalog from a CSV.</p>

      <div className="mt-4 rounded-xl border-2 border-nexus-steel/15 bg-white p-4">
        <p className="text-sm text-nexus-steel">
          Required columns: <code>sku, name, barcodeValue</code>. Optional: <code>category, unitCost,
          reorderThreshold</code>. Existing SKUs are updated; new SKUs are created.
        </p>

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="tap-target mt-4 w-full rounded-lg border-2 border-nexus-steel/30 bg-white px-4"
        />

        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={8}
          placeholder="Or paste CSV text here"
          className="mt-3 w-full rounded-lg border-2 border-nexus-steel/30 p-3 font-mono text-sm"
        />

        <button
          onClick={runImport}
          disabled={busy || !csvText.trim()}
          className="tap-target mt-4 rounded-lg bg-nexus-navy px-6 font-medium text-white disabled:opacity-40"
        >
          {busy ? "Importing…" : "Run import"}
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border-2 border-nexus-danger/40 bg-white p-3 text-sm text-nexus-danger">
          {error}
        </p>
      )}

      {results && (
        <div className="mt-4 rounded-xl border-2 border-nexus-ok/40 bg-white p-4">
          <p>
            Created <span className="font-medium">{results.created}</span>, updated{" "}
            <span className="font-medium">{results.updated}</span>
          </p>
          {results.skipped.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium text-nexus-warn">Skipped rows</p>
              <ul className="mt-1 text-sm text-nexus-steel">
                {results.skipped.map((s, i) => (
                  <li key={i}>
                    Line {s.line}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
