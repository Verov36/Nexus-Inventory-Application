import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasDatabase,
  jsonRequest,
  mockAuthAs,
  resetDatabase,
  seedBasics,
  truckQty,
  warehouseQty,
  type Seeded,
} from "./setup";

// Races and stale reads around counts, corrections and reviews.

describe.skipIf(!hasDatabase)("count & review integrity (real database)", () => {
  let s: Seeded;
  let reviewer: { id: string };

  beforeEach(async () => {
    vi.resetModules();
    await resetDatabase();
    s = await seedBasics();
    reviewer = await s.prisma.user.create({
      data: { name: "Rita Reviewer", email: "rita@test.local", passwordHash: "x", role: "MANAGER" },
    });
    await s.prisma.stockLevel.create({
      data: { partId: s.capacitor.id, truckId: s.truck.id, locationType: "TRUCK", quantity: 5 },
    });
  });

  const p = (id: string) => ({ params: Promise.resolve({ id }) });
  const tick = () => new Promise((r) => setTimeout(r, 5));

  /** Tech starts a count, counts the capacitor as `counted`, optionally does something, submits. */
  async function techCounts(counted: number, between?: () => Promise<void>) {
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const list = await import("@/app/api/truck-counts/route");
    const started = await list.POST(await jsonRequest("/api/truck-counts", "POST", { truckId: s.truck.id }));
    const countId = (await started.json()).count.id as string;
    const detail = await import("@/app/api/truck-counts/[id]/route");
    await detail.PATCH(
      await jsonRequest(`/api/truck-counts/${countId}`, "PATCH", { lines: [{ partId: s.capacitor.id, countedQty: counted }] }),
      p(countId)
    );
    if (between) {
      await tick();
      await between();
    }
    vi.resetModules();
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const submit = await import("@/app/api/truck-counts/[id]/submit/route");
    expect((await submit.POST(await jsonRequest(`/api/truck-counts/${countId}/submit`, "POST"), p(countId))).status).toBe(200);
    vi.resetModules();
    return countId;
  }

  async function applyAs(userId: string, countId: string) {
    mockAuthAs({ id: userId, role: "MANAGER" });
    const review = await import("@/app/api/truck-counts/[id]/review/route");
    return review.POST(await jsonRequest(`/api/truck-counts/${countId}/review`, "POST", { decision: "APPLY" }), p(countId));
  }

  async function asTech<T>(fn: () => Promise<T>) {
    vi.resetModules();
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    return fn();
  }

  it("a count applied twice at once posts exactly once", async () => {
    const countId = await techCounts(3); // 2 short
    const [a, b] = await Promise.all([applyAs(reviewer.id, countId), applyAs(reviewer.id, countId)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(3);
    expect(await s.prisma.inventoryTransaction.count({ where: { type: "ADJUSTMENT" } })).toBe(1);
  });

  it("stock loaded onto the truck after it was counted isn't double-counted", async () => {
    // Truck has 5; tech counts 5 (nothing missing). Then 3 more are loaded
    // before the count is applied. Applying must leave 8 — not 5, not 11.
    const countId = await techCounts(5, () =>
      asTech(async () => {
        const { POST } = await import("@/app/api/inventory/checkout/route");
        const res = await POST(
          await jsonRequest("/api/inventory/checkout", "POST", {
            partId: s.capacitor.id,
            truckId: s.truck.id,
            quantity: 3,
            checkoutType: "RESTOCK",
            warehouseId: s.warehouse.id,
          })
        );
        expect(res.status).toBe(201);
      })
    );
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(8);
    const res = await applyAs(reviewer.id, countId);
    expect(res.status).toBe(200);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(8);
    expect(await s.prisma.inventoryTransaction.count({ where: { type: "ADJUSTMENT" } })).toBe(0);
  });

  it("a real shortage is still posted when other stock moved during the count", async () => {
    // Counted 4 of 5 (1 missing), then 2 returned to the warehouse. The truck
    // should end at 2 with exactly one unit written off.
    const countId = await techCounts(4, () =>
      asTech(async () => {
        const { POST } = await import("@/app/api/inventory/return/route");
        const res = await POST(
          await jsonRequest("/api/inventory/return", "POST", { partId: s.capacitor.id, truckId: s.truck.id, quantity: 2 })
        );
        expect(res.status).toBe(201);
      })
    );
    const res = await applyAs(reviewer.id, countId);
    expect(res.status).toBe(200);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(2);
    const adj = await s.prisma.inventoryTransaction.findMany({ where: { type: "ADJUSTMENT" } });
    expect(adj).toHaveLength(1);
    expect(adj[0].quantity).toBe(1);
    expect(adj[0].fromTruckId).toBe(s.truck.id);
    const line = await s.prisma.truckCountLine.findFirstOrThrow({ where: { countId, partId: s.capacitor.id } });
    expect(line.appliedDelta).toBe(-1);
  });

  it("only one count can be in progress per truck, even when started at the same instant", async () => {
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const list = await import("@/app/api/truck-counts/route");
    const results = await Promise.all(
      [1, 2, 3].map(async () => (await list.POST(await jsonRequest("/api/truck-counts", "POST", { truckId: s.truck.id }))).status)
    );
    expect(results.filter((r) => r === 201)).toHaveLength(1);
    expect(await s.prisma.truckCount.count()).toBe(1);
  });

  it("a tech never sees expected quantities or totals while counting", async () => {
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const list = await import("@/app/api/truck-counts/route");
    const body = await (await list.POST(await jsonRequest("/api/truck-counts", "POST", { truckId: s.truck.id }))).json();
    expect(body.count.lines.every((l: { expectedQty: number | null }) => l.expectedQty === null)).toBe(true);
    const listed = await (await list.GET(await jsonRequest("/api/truck-counts", "GET"))).json();
    expect(listed.counts[0].unitsShort).toBeNull();
    expect(listed.counts[0].varianceValue).toBeNull();
  });

  it("a count can't be edited after it's submitted", async () => {
    const countId = await techCounts(3);
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const detail = await import("@/app/api/truck-counts/[id]/route");
    const res = await detail.PATCH(
      await jsonRequest(`/api/truck-counts/${countId}`, "PATCH", { lines: [{ partId: s.capacitor.id, countedQty: 5 }] }),
      p(countId)
    );
    expect(res.status).toBe(409);
  });

  it("warehouse correction refuses when stock moved since the person looked", async () => {
    mockAuthAs({ id: s.manager.id, role: "MANAGER" });
    const { POST } = await import("@/app/api/inventory/warehouse-adjust/route");
    const req = () =>
      jsonRequest("/api/inventory/warehouse-adjust", "POST", {
        partId: s.capacitor.id,
        warehouseId: s.warehouse.id,
        actualQuantity: 8,
        expectedQuantity: 10,
        reason: "cycle count",
      });
    // Double submit: the first sets 10 -> 8; the second sees 8, not the 10 it
    // was based on, and refuses instead of taking it to 6.
    const [a, b] = await Promise.all([POST(await req()), POST(await req())]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await warehouseQty(s.capacitor.id, s.warehouse.id)).toBe(8);
  });

  it("a justification can't be decided twice, or by the person who submitted it", async () => {
    const j = await s.prisma.overageJustification.create({
      data: { submittedById: s.manager.id, truckId: s.truck.id, explanation: "big job" },
    });
    mockAuthAs({ id: s.manager.id, role: "MANAGER" });
    let mod = await import("@/app/api/justifications/[id]/review/route");
    const own = await mod.POST(await jsonRequest(`/api/justifications/${j.id}/review`, "POST", { decision: "APPROVED" }), p(j.id));
    expect(own.status).toBe(403);

    vi.resetModules();
    mockAuthAs({ id: reviewer.id, role: "MANAGER" });
    mod = await import("@/app/api/justifications/[id]/review/route");
    const [a, b] = await Promise.all([
      mod.POST(await jsonRequest(`/api/justifications/${j.id}/review`, "POST", { decision: "APPROVED" }), p(j.id)),
      mod.POST(await jsonRequest(`/api/justifications/${j.id}/review`, "POST", { decision: "REJECTED" }), p(j.id)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});
