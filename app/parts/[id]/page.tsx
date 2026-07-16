"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { canEditParts, canReceiveWarehouseStock } from "@/lib/roles";
import { printLabel } from "@/lib/zebra-print";

type Part = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  description: string | null;
  unitCost: string | null;
  barcodeValue: string;
  reorderThreshold: number;
};

type Transaction = {
  id: string;
  type: string;
  checkoutType: string | null;
  quantity: number;
  createdAt: string;
  performedBy: { name: string };
  partUsage: { job: { jobNumber: string } } | null;
  justification: { status: string } | null;
  notes: string | null;
  direction: "increase" | "decrease";
  toWarehouseId: string | null;
  fromWarehouseId: string | null;
};

export default function PartDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string; canReceiveParts?: boolean } | undefined)?.role;
  const canReceiveParts = (session?.user as { canReceiveParts?: boolean } | undefined)?.canReceiveParts;
  const editable = canEditParts(role);
  const canPrint = editable || canReceiveWarehouseStock(role, canReceiveParts);

  const [part, setPart] = useState<Part | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [form, setForm] = useState({ name: "", category: "", reorderThreshold: "" });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printStatus, setPrintStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/parts/${params.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.part) {
          setPart(d.part);
          setForm({
            name: d.part.name,
            category: d.part.category ?? "",
            reorderThreshold: String(d.part.reorderThreshold),
          });
        }
      });
    fetch(`/api/parts/${params.id}/transactions`)
      .then((r) => (r.ok ? r.json() : { transactions: [] }))
      .then((d) => setTransactions(d.transactions ?? []));
  }, [params.id]);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/parts/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        category: form.category || null,
        reorderThreshold: Number(form.reorderThreshold),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(typeof data.error === "string" ? data.error : "Couldn't save.");
      return;
    }
    const data = await res.json();
    setPart(data.part);
    setEditing(false);
  }

  async function handlePrint() {
    if (!part) return;
    setPrintStatus("Printing…");
    try {
      await printLabel({
        sku: part.sku,
        name: part.name,
        barcodeValue: part.barcodeValue,
        category: part.category,
      });
      setPrintStatus("Sent to printer");
    } catch (err) {
      setPrintStatus(err instanceof Error ? err.message : "Print failed");
    }
  }

  if (!part) {
    return (
      <main className="mx-auto min-h-screen max-w-2xl bg-nexus-paper px-4 pt-8">
        <p className="text-nexus-steel">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-nexus-paper px-4 pb-24 pt-8">
      <button onClick={() => router.push("/")} className="text-sm text-nexus-steel underline">
        ← Back to inventory
      </button>

      <div className="mt-3 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-medium text-nexus-navy">{part.name}</h1>
          <p className="text-sm text-nexus-steel">
            {part.sku} {part.category ? `· ${part.category}` : ""}
          </p>
        </div>
        {canPrint && (
          <button
            onClick={handlePrint}
            className="tap-target rounded-lg border-2 border-nexus-navy px-4 text-sm font-medium text-nexus-navy"
          >
            Print label
          </button>
        )}
      </div>
      {printStatus && <p className="mt-1 text-sm text-nexus-steel">{printStatus}</p>}

      <section className="mt-4 rounded-xl border-2 border-nexus-steel/15 bg-white p-4">
        {!editing ? (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-nexus-steel">Reorder threshold</dt>
                <dd className="font-medium text-nexus-navy">{part.reorderThreshold}</dd>
              </div>
              <div>
                <dt className="text-nexus-steel">Barcode value</dt>
                <dd className="font-medium text-nexus-navy">{part.barcodeValue}</dd>
              </div>
            </dl>
            {editable && (
              <button
                onClick={() => setEditing(true)}
                className="tap-target mt-4 rounded-lg bg-nexus-navy px-4 text-sm font-medium text-white"
              >
                Edit
              </button>
            )}
          </>
        ) : (
          <>
            <label className="block text-xs text-nexus-steel">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="tap-target mt-1 w-full rounded-lg border-2 border-nexus-steel/30 px-3"
            />
            <label className="mt-3 block text-xs text-nexus-steel">Category</label>
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="tap-target mt-1 w-full rounded-lg border-2 border-nexus-steel/30 px-3"
            />
            <label className="mt-3 block text-xs text-nexus-steel">Reorder threshold</label>
            <input
              type="number"
              min={0}
              value={form.reorderThreshold}
              onChange={(e) => setForm({ ...form, reorderThreshold: e.target.value })}
              className="tap-target mt-1 w-32 rounded-lg border-2 border-nexus-steel/30 px-3"
            />
            {error && <p className="mt-2 text-sm text-nexus-danger">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="tap-target flex-1 rounded-lg bg-nexus-ok font-medium text-white disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="tap-target rounded-lg border-2 border-nexus-steel/30 px-4 text-nexus-steel"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-nexus-steel">History</h2>
        <ul className="mt-2 divide-y divide-nexus-steel/10 rounded-xl border-2 border-nexus-steel/15 bg-white">
          {transactions.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div>
                <p className="font-medium text-nexus-navy">
                  {t.type === "RECEIVE" && "Received"}
                  {t.type === "CHECKOUT" && (t.checkoutType === "RESTOCK" ? "Truck restock" : "Job checkout")}
                  {t.type === "RETURN" && "Returned to warehouse"}
                  {t.type === "ADJUSTMENT" &&
                    (t.toWarehouseId || t.fromWarehouseId ? "Warehouse count correction" : "Written off")}
                  {t.partUsage ? ` · Job ${t.partUsage.job.jobNumber}` : ""}
                </p>
                <p className="text-nexus-steel">
                  {t.performedBy.name} · {new Date(t.createdAt).toLocaleString()}
                </p>
                {t.notes && <p className="mt-0.5 text-xs italic text-nexus-steel">{t.notes}</p>}
              </div>
              <div className="text-right">
                <p className="font-medium text-nexus-navy">
                  {t.direction === "increase" ? "+" : "-"}
                  {t.quantity}
                </p>
                {t.justification && (
                  <p className="text-xs text-nexus-warn">Flagged: {t.justification.status}</p>
                )}
              </div>
            </li>
          ))}
          {transactions.length === 0 && <li className="px-4 py-3 text-nexus-steel">No activity yet.</li>}
        </ul>
      </section>
    </main>
  );
}
