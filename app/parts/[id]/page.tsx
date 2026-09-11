"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { canEditParts, canReceiveWarehouseStock } from "@/lib/roles";
import { printLabel } from "@/lib/zebra-print";
import { formatMoney } from "@/lib/money";

type Part = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  description: string | null;
  unitCost: string | null;
  barcodeValue: string;
  reorderThreshold: number;
  supplier?: string | null;
  supplierPartNumber?: string | null;
  reorderQty?: number;
  orderedAt?: string | null;
  orderedQty?: number | null;
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
  const [form, setForm] = useState({
    name: "",
    category: "",
    reorderThreshold: "",
    unitCost: "",
    description: "",
    supplier: "",
    supplierPartNumber: "",
    reorderQty: "",
  });
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
            unitCost: d.part.unitCost === null || d.part.unitCost === undefined ? "" : String(d.part.unitCost),
            description: d.part.description ?? "",
            supplier: d.part.supplier ?? "",
            supplierPartNumber: d.part.supplierPartNumber ?? "",
            reorderQty: String(d.part.reorderQty ?? 0),
          });
        }
      });
    fetch(`/api/parts/${params.id}/transactions`)
      .then((r) => (r.ok ? r.json() : { transactions: [] }))
      .then((d) => setTransactions(d.transactions ?? []));
  }, [params.id]);

  async function save() {
    const threshold = Number(form.reorderThreshold);
    if (!Number.isInteger(threshold) || threshold < 0) {
      setError("Reorder threshold must be a whole number of 0 or more.");
      return;
    }
    const costText = form.unitCost.trim().replace(/^\$/, "");
    const unitCost = costText === "" ? null : Number(costText);
    if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
      setError("Unit cost must be a number of 0 or more, or left blank.");
      return;
    }
    const reorderQty = form.reorderQty.trim() === "" ? 0 : Number(form.reorderQty);
    if (!Number.isInteger(reorderQty) || reorderQty < 0) {
      setError("Reorder quantity must be a whole number of 0 or more (0 lets the app suggest).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/parts/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category.trim() || null,
          reorderThreshold: threshold,
          unitCost,
          description: form.description.trim() || null,
          supplier: form.supplier.trim() || null,
          supplierPartNumber: form.supplierPartNumber.trim() || null,
          reorderQty,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `Couldn't save (${res.status}).`);
        return;
      }
      setPart(data.part);
      setEditing(false);
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setSaving(false);
    }
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
                <dd className="font-data font-medium text-nexus-navy">{part.barcodeValue}</dd>
              </div>
              <div>
                <dt className="text-nexus-steel">Unit cost</dt>
                <dd className="font-data font-medium text-nexus-navy">
                  {part.unitCost === null ? <span className="text-nexus-warn">not set</span> : formatMoney(Number(part.unitCost))}
                </dd>
              </div>
              <div>
                <dt className="text-nexus-steel">Supplier</dt>
                <dd className="text-nexus-navy">
                  {part.supplier || <span className="text-nexus-steel">not set</span>}
                  {part.supplierPartNumber && (
                    <span className="ml-1 font-data text-xs text-nexus-steel">#{part.supplierPartNumber}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-nexus-steel">Reorder quantity</dt>
                <dd className="font-data text-nexus-navy">
                  {part.reorderQty ? part.reorderQty : <span className="text-nexus-steel">suggested automatically</span>}
                </dd>
              </div>
              {part.orderedAt && (
                <div>
                  <dt className="text-nexus-steel">On order</dt>
                  <dd className="text-nexus-ok">
                    {part.orderedQty} ordered {new Date(part.orderedAt).toLocaleDateString()}
                  </dd>
                </div>
              )}
              {part.description && (
                <div>
                  <dt className="text-nexus-steel">Description</dt>
                  <dd className="text-nexus-navy">{part.description}</dd>
                </div>
              )}
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
            <div className="mt-3 flex flex-wrap gap-3">
              <div>
                <label className="block text-xs text-nexus-steel">Reorder threshold</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.reorderThreshold}
                  onChange={(e) => setForm({ ...form, reorderThreshold: e.target.value })}
                  className="tap-target mt-1 w-32 rounded-lg border-2 border-nexus-steel/30 px-3"
                />
              </div>
              <div>
                <label className="block text-xs text-nexus-steel">Unit cost ($)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={form.unitCost}
                  onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                  placeholder="0.00"
                  className="tap-target mt-1 w-32 rounded-lg border-2 border-nexus-steel/30 px-3 font-data"
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <div className="min-w-[10rem] flex-1">
                <label className="block text-xs text-nexus-steel">Supplier</label>
                <input
                  value={form.supplier}
                  onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                  placeholder="e.g. Johnstone Supply"
                  className="tap-target mt-1 w-full rounded-lg border-2 border-nexus-steel/30 px-3"
                />
              </div>
              <div className="min-w-[10rem] flex-1">
                <label className="block text-xs text-nexus-steel">Supplier part #</label>
                <input
                  value={form.supplierPartNumber}
                  onChange={(e) => setForm({ ...form, supplierPartNumber: e.target.value })}
                  className="tap-target mt-1 w-full rounded-lg border-2 border-nexus-steel/30 px-3 font-data"
                />
              </div>
              <div>
                <label className="block text-xs text-nexus-steel">Reorder qty (0 = suggest)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.reorderQty}
                  onChange={(e) => setForm({ ...form, reorderQty: e.target.value })}
                  className="tap-target mt-1 w-32 rounded-lg border-2 border-nexus-steel/30 px-3"
                />
              </div>
            </div>
            <label className="mt-3 block text-xs text-nexus-steel">Description (optional)</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="tap-target mt-1 w-full rounded-lg border-2 border-nexus-steel/30 px-3"
            />
            {error && <p className="mt-2 text-sm text-nexus-danger">{error}</p>}
            <div className="mt-4 flex gap-2">
              <button
                onClick={save}
                disabled={saving || !form.name.trim()}
                className="tap-target flex-1 rounded-lg bg-nexus-ok font-medium text-white disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
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
