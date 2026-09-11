"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Printer, Search, Trash2, Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

type Part = { id: string; sku: string; name: string; category: string | null; barcodeValue: string };
type Row = { part: Part; copies: number };

// Avery 5160 / 8160 (and most "30 per sheet" address labels): 3 across,
// 10 down, 2.625in x 1in, on US Letter. Any laser or inkjet printer works.
const SHEET = { cols: 3, rows: 10, labelW: 2.625, labelH: 1, marginTop: 0.5, marginLeft: 0.1875, gapX: 0.125 };
const PER_SHEET = SHEET.cols * SHEET.rows;

export default function LabelsPage() {
  return (
    <Suspense fallback={null}>
      <LabelsScreen />
    </Suspense>
  );
}

function LabelsScreen() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Part[]>([]);
  const [qr, setQr] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Preload from ?ids=a,b,c (e.g. a link from the part page).
  useEffect(() => {
    const ids = (searchParams.get("ids") ?? "").split(",").filter(Boolean);
    if (ids.length === 0) return;
    Promise.all(
      ids.map((id) =>
        fetch(`/api/parts/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => (d?.part as Part | undefined) ?? null)
          .catch(() => null)
      )
    ).then((parts) => {
      setRows((prev) => {
        const next = [...prev];
        for (const p of parts) if (p && !next.some((r) => r.part.id === p.id)) next.push({ part: p, copies: 1 });
        return next;
      });
    });
  }, [searchParams]);

  // Render QR codes for any part we don't have yet.
  useEffect(() => {
    const missing = rows.filter((r) => !qr[r.part.id]);
    if (missing.length === 0) return;
    Promise.all(
      missing.map((r) =>
        QRCode.toDataURL(r.part.barcodeValue, { errorCorrectionLevel: "M", margin: 0, width: 160 })
          .then((url) => [r.part.id, url] as const)
          .catch(() => [r.part.id, ""] as const)
      )
    ).then((pairs) => setQr((prev) => ({ ...prev, ...Object.fromEntries(pairs) })));
  }, [rows, qr]);

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/parts/search?q=${encodeURIComponent(q)}`);
      const d = await res.json().catch(() => ({}));
      const parts: { id: string }[] = res.ok ? d.parts ?? [] : [];
      // Search results don't carry the barcode value; fetch the full part on add.
      setResults(parts as Part[]);
    } catch {
      setResults([]);
    }
  }

  async function add(partId: string) {
    setError(null);
    if (rows.some((r) => r.part.id === partId)) {
      setRows((prev) => prev.map((r) => (r.part.id === partId ? { ...r, copies: r.copies + 1 } : r)));
      return;
    }
    try {
      const res = await fetch(`/api/parts/${partId}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.part) {
        setError("Couldn't load that part.");
        return;
      }
      setRows((prev) => [...prev, { part: d.part as Part, copies: 1 }]);
      setQuery("");
      setResults([]);
    } catch {
      setError("Couldn't reach the server — check your connection.");
    }
  }

  const labels = useMemo(() => {
    const out: (Part | null)[] = Array.from({ length: Math.min(skip, PER_SHEET - 1) }, () => null);
    for (const r of rows) for (let i = 0; i < r.copies; i++) out.push(r.part);
    return out;
  }, [rows, skip]);
  const sheets = Math.max(1, Math.ceil(labels.length / PER_SHEET));

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 md:pt-10">
      <div className="print-hide">
        <PageHeader
          title="Label sheet"
          subtitle="Print QR labels on standard 30-per-sheet address labels (Avery 5160 / 8160) from any printer."
          actions={
            <Button onClick={() => window.print()} disabled={labels.length === 0} icon={<Printer size={16} />}>
              Print {sheets > 1 ? `${sheets} sheets` : "sheet"}
            </Button>
          }
        />

        {error && (
          <Card accent="danger" className="mt-4 p-3">
            <p className="text-sm text-nexus-danger">{error}</p>
          </Card>
        )}

        <div className="relative mt-5">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-nexus-steelfaint" />
          <input
            value={query}
            onChange={(e) => search(e.target.value)}
            placeholder="Search parts by name or SKU to add labels"
            className="tap-target w-full rounded-lg border-2 border-nexus-line bg-white pl-9 pr-4"
          />
          {results.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-lg border-2 border-nexus-line bg-white shadow-lg">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => add(p.id)}
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

        {rows.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              icon={<Printer size={32} />}
              title="No labels yet"
              description="Search above to add parts. Each label carries the part's QR code, SKU and name, and scans back in at receiving or checkout."
            />
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {rows.map((r) => (
              <Card key={r.part.id} as="li" className="p-3">
                <div className="flex items-center gap-3">
                  {qr[r.part.id] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qr[r.part.id]} alt="" className="h-10 w-10" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-nexus-navy">{r.part.name}</p>
                    <p className="font-data text-xs text-nexus-steel">{r.part.sku}</p>
                  </div>
                  <label className="text-xs text-nexus-steel">Copies</label>
                  <input
                    type="number"
                    min={1}
                    max={300}
                    step={1}
                    inputMode="numeric"
                    value={r.copies}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x) =>
                          x.part.id === r.part.id ? { ...x, copies: Math.max(1, Math.min(300, Math.floor(e.target.valueAsNumber || 1))) } : x
                        )
                      )
                    }
                    className="tap-target w-20 rounded-lg border-2 border-nexus-line px-2 text-center font-data"
                  />
                  <button
                    onClick={() => setRows((prev) => prev.filter((x) => x.part.id !== r.part.id))}
                    aria-label="Remove"
                    className="tap-target w-10 text-nexus-steel hover:text-nexus-danger"
                  >
                    <Trash2 size={16} className="mx-auto" />
                  </button>
                </div>
              </Card>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-nexus-steel">
          <label className="flex items-center gap-2">
            Skip already-used labels on the first sheet:
            <input
              type="number"
              min={0}
              max={PER_SHEET - 1}
              step={1}
              inputMode="numeric"
              value={skip}
              onChange={(e) => setSkip(Math.max(0, Math.min(PER_SHEET - 1, Math.floor(e.target.valueAsNumber || 0))))}
              className="tap-target w-16 rounded-lg border-2 border-nexus-line px-2 text-center font-data"
            />
          </label>
          <span>
            {labels.length - Math.min(skip, PER_SHEET - 1)} labels · {sheets} {sheets === 1 ? "sheet" : "sheets"}
          </span>
        </div>
        <p className="mt-2 text-xs text-nexus-steel">
          In the print dialog choose US Letter, 100% scale (no &quot;fit to page&quot;), and turn margins off or set them to
          &quot;none&quot; so the grid lines up with the label stock.
        </p>
      </div>

      {/* Print layout — hidden on screen except a small preview, full-size on paper. */}
      <div className="label-sheets mt-6">
        {Array.from({ length: sheets }, (_, s) => (
          <div key={s} className="label-sheet">
            {labels.slice(s * PER_SHEET, (s + 1) * PER_SHEET).map((part, i) => (
              <div key={i} className="label">
                {part && (
                  <>
                    {qr[part.id] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qr[part.id]} alt="" className="label-qr" />
                    )}
                    <div className="label-text">
                      <div className="label-sku">{part.sku}</div>
                      <div className="label-name">{part.name}</div>
                      {part.category && <div className="label-cat">{part.category}</div>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
