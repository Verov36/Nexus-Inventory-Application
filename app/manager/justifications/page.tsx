"use client";

import { useEffect, useState } from "react";

type Justification = {
  id: string;
  explanation: string;
  relatedJobNumbers: string[];
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  truck: { label: string; tech: { name: string } | null };
  submittedBy: { name: string };
  transaction: { part: { sku: string; name: string }; quantity: number } | null;
};

export default function JustificationsPage() {
  const [items, setItems] = useState<Justification[]>([]);
  const [filter, setFilter] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");

  async function load() {
    const res = await fetch(`/api/justifications?status=${filter}`);
    const data = await res.json();
    setItems(data.justifications ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function review(id: string, decision: "APPROVED" | "REJECTED") {
    await fetch(`/api/justifications/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    load();
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-nexus-paper px-4 pb-24 pt-8">
      <h1 className="text-2xl font-medium text-nexus-navy">Overage justifications</h1>
      <p className="mt-1 text-nexus-steel">
        Job-use checkouts that pushed a truck over its manager-set cap, with the tech's explanation.
      </p>

      <div className="mt-4 flex gap-2">
        {(["PENDING", "APPROVED", "REJECTED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`tap-target rounded-lg px-4 text-sm font-medium ${
              filter === s ? "bg-nexus-navy text-white" : "border-2 border-nexus-steel/30 text-nexus-navy"
            }`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border-2 border-nexus-steel/15 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-nexus-navy">
                {item.truck.label} — {item.truck.tech?.name ?? "unassigned"}
              </p>
              <p className="text-xs text-nexus-steel">{new Date(item.createdAt).toLocaleString()}</p>
            </div>
            {item.transaction && (
              <p className="mt-1 text-sm text-nexus-steel">
                {item.transaction.quantity} × {item.transaction.part.name}{" "}
                <span className="font-data text-xs">({item.transaction.part.sku})</span>
              </p>
            )}
            <p className="mt-2">{item.explanation}</p>
            <p className="mt-1 text-sm text-nexus-steel">
              Related jobs: {item.relatedJobNumbers.join(", ")}
            </p>

            {item.status === "PENDING" && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => review(item.id, "APPROVED")}
                  className="tap-target flex-1 rounded-lg bg-nexus-ok font-medium text-white"
                >
                  Approve
                </button>
                <button
                  onClick={() => review(item.id, "REJECTED")}
                  className="tap-target flex-1 rounded-lg bg-nexus-danger font-medium text-white"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-nexus-steel">Nothing here.</p>}
      </div>
    </main>
  );
}
