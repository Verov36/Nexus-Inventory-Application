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

// Route handlers exercised end to end (minus HTTP): the request body goes in,
// the JSON and status come out, and the database is checked afterwards.

describe.skipIf(!hasDatabase)("stock routes (real database)", () => {
  let s: Seeded;

  beforeEach(async () => {
    vi.resetModules();
    await resetDatabase();
    s = await seedBasics();
    // Put 5 capacitors on the tech's truck to return / write off.
    await s.prisma.stockLevel.create({
      data: { partId: s.capacitor.id, truckId: s.truck.id, locationType: "TRUCK", quantity: 5 },
    });
  });

  it("return: tech moves stock off their own truck back to the warehouse", async () => {
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const { POST } = await import("@/app/api/inventory/return/route");
    const res = await POST(await jsonRequest("/api/inventory/return", "POST", { partId: s.capacitor.id, truckId: s.truck.id, quantity: 2, notes: "unused" }));
    expect(res.status).toBe(201);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(3);
    expect(await warehouseQty(s.capacitor.id, s.warehouse.id)).toBe(12);
    const tx = await s.prisma.inventoryTransaction.findFirst({ where: { type: "RETURN" } });
    expect(tx?.notes).toBe("unused");
  });

  it("return: can't return more than is on the truck, and can't touch another tech's truck", async () => {
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const { POST } = await import("@/app/api/inventory/return/route");
    const tooMany = await POST(await jsonRequest("/api/inventory/return", "POST", { partId: s.capacitor.id, truckId: s.truck.id, quantity: 6 }));
    expect(tooMany.status).toBe(409);
    const wrongTruck = await POST(await jsonRequest("/api/inventory/return", "POST", { partId: s.capacitor.id, truckId: s.otherTruck.id, quantity: 1 }));
    expect(wrongTruck.status).toBe(403);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(5);
  });

  it("write-off: manager only, needs a reason, leaves an ADJUSTMENT", async () => {
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    let mod = await import("@/app/api/inventory/adjust/route");
    const asTech = await mod.POST(await jsonRequest("/api/inventory/adjust", "POST", { partId: s.capacitor.id, truckId: s.truck.id, quantity: 1, reason: "dropped" }));
    expect(asTech.status).toBe(403);

    vi.resetModules();
    mockAuthAs({ id: s.manager.id, role: "MANAGER" });
    mod = await import("@/app/api/inventory/adjust/route");
    const noReason = await mod.POST(await jsonRequest("/api/inventory/adjust", "POST", { partId: s.capacitor.id, truckId: s.truck.id, quantity: 1, reason: " " }));
    expect(noReason.status).toBe(400);
    const ok = await mod.POST(await jsonRequest("/api/inventory/adjust", "POST", { partId: s.capacitor.id, truckId: s.truck.id, quantity: 2, reason: "dropped off a ladder" }));
    expect(ok.status).toBe(201);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(3);
    // Warehouse untouched by a write-off.
    expect(await warehouseQty(s.capacitor.id, s.warehouse.id)).toBe(10);
  });

  it("warehouse count correction: records the delta either direction", async () => {
    mockAuthAs({ id: s.manager.id, role: "MANAGER" });
    const { POST } = await import("@/app/api/inventory/warehouse-adjust/route");
    const down = await POST(await jsonRequest("/api/inventory/warehouse-adjust", "POST", { partId: s.capacitor.id, actualQuantity: 7, reason: "physical count" }));
    expect(down.status).toBe(201);
    expect((await down.json()).delta).toBe(-3);
    expect(await warehouseQty(s.capacitor.id, s.warehouse.id)).toBe(7);

    const up = await POST(await jsonRequest("/api/inventory/warehouse-adjust", "POST", { partId: s.capacitor.id, actualQuantity: 9, reason: "found a box" }));
    expect((await up.json()).delta).toBe(2);
    const same = await POST(await jsonRequest("/api/inventory/warehouse-adjust", "POST", { partId: s.capacitor.id, actualQuantity: 9, reason: "recount" }));
    expect((await same.json()).unchanged).toBe(true);
    expect(await s.prisma.inventoryTransaction.count({ where: { type: "ADJUSTMENT" } })).toBe(2);
  });

  it("receive: only designated receivers, and it clears an on-order flag", async () => {
    await s.prisma.part.update({ where: { id: s.filter.id }, data: { orderedAt: new Date(), orderedQty: 10, orderedById: s.manager.id } });

    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    let mod = await import("@/app/api/inventory/receive/route");
    const asTech = await mod.POST(await jsonRequest("/api/inventory/receive", "POST", { partId: s.filter.id, quantity: 10 }));
    expect(asTech.status).toBe(403);

    await s.prisma.user.update({ where: { id: s.manager.id }, data: { canReceiveParts: true } });
    vi.resetModules();
    mockAuthAs({ id: s.manager.id, role: "MANAGER" });
    mod = await import("@/app/api/inventory/receive/route");
    // No warehouseId in the body: the server resolves the only warehouse.
    const ok = await mod.POST(await jsonRequest("/api/inventory/receive", "POST", { partId: s.filter.id, quantity: 10 }));
    expect(ok.status).toBe(201);
    expect(await warehouseQty(s.filter.id, s.warehouse.id)).toBe(30);
    const part = await s.prisma.part.findUnique({ where: { id: s.filter.id } });
    expect(part?.orderedAt).toBeNull();
  });

  it("signed-out requests get a 401", async () => {
    mockAuthAs(null);
    const { POST } = await import("@/app/api/inventory/return/route");
    const res = await POST(await jsonRequest("/api/inventory/return", "POST", { partId: s.capacitor.id, truckId: s.truck.id, quantity: 1 }));
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!hasDatabase)("truck counts (real database)", () => {
  let s: Seeded;

  beforeEach(async () => {
    vi.resetModules();
    await resetDatabase();
    s = await seedBasics();
    await s.prisma.stockLevel.createMany({
      data: [
        { partId: s.capacitor.id, truckId: s.truck.id, locationType: "TRUCK", quantity: 5 },
        { partId: s.filter.id, truckId: s.truck.id, locationType: "TRUCK", quantity: 2 },
      ],
    });
  });

  it("tech counts blind, submits; manager sees variances and applies adjustments", async () => {
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const list = await import("@/app/api/truck-counts/route");
    const started = await list.POST(await jsonRequest("/api/truck-counts", "POST", { truckId: s.truck.id }));
    expect(started.status).toBe(201);
    const countId = (await started.json()).count.id as string;

    // A second start is refused while one is open.
    const again = await list.POST(await jsonRequest("/api/truck-counts", "POST", { truckId: s.truck.id }));
    expect(again.status).toBe(409);

    const detail = await import("@/app/api/truck-counts/[id]/route");
    const blind = await detail.GET(await jsonRequest(`/api/truck-counts/${countId}`, "GET"), { params: { id: countId } });
    const blindBody = await blind.json();
    expect(blindBody.count.lines).toHaveLength(2);
    expect(blindBody.count.lines[0].expectedQty).toBeNull();

    // Found 3 capacitors (short 2), 2 filters (match), plus a part not on the list.
    const patched = await detail.PATCH(
      await jsonRequest(`/api/truck-counts/${countId}`, "PATCH", {
        lines: [
          { partId: s.capacitor.id, countedQty: 3 },
          { partId: s.filter.id, countedQty: 2 },
        ],
        notes: "box was open",
      }),
      { params: { id: countId } }
    );
    expect(patched.status).toBe(200);

    const submit = await import("@/app/api/truck-counts/[id]/submit/route");
    const submitted = await submit.POST(await jsonRequest(`/api/truck-counts/${countId}/submit`, "POST"), { params: { id: countId } });
    expect(submitted.status).toBe(200);

    // Tech can't apply.
    const review = await import("@/app/api/truck-counts/[id]/review/route");
    const asTech = await review.POST(await jsonRequest(`/api/truck-counts/${countId}/review`, "POST", { decision: "APPLY" }), { params: { id: countId } });
    expect(asTech.status).toBe(403);

    vi.resetModules();
    mockAuthAs({ id: s.manager.id, role: "MANAGER" });
    const detailM = await import("@/app/api/truck-counts/[id]/route");
    const seen = await (await detailM.GET(await jsonRequest(`/api/truck-counts/${countId}`, "GET"), { params: { id: countId } })).json();
    expect(seen.count.unitsShort).toBe(2);
    expect(seen.count.unitsOver).toBe(0);
    expect(seen.count.varianceValue).toBe(-25);

    const reviewM = await import("@/app/api/truck-counts/[id]/review/route");
    const applied = await reviewM.POST(await jsonRequest(`/api/truck-counts/${countId}/review`, "POST", { decision: "APPLY" }), { params: { id: countId } });
    expect(applied.status).toBe(200);
    expect((await applied.json()).adjustments).toBe(1);

    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(3);
    expect(await truckQty(s.filter.id, s.truck.id)).toBe(2);
    const adj = await s.prisma.inventoryTransaction.findMany({ where: { type: "ADJUSTMENT" } });
    expect(adj).toHaveLength(1);
    expect(adj[0].fromTruckId).toBe(s.truck.id);
    expect(adj[0].quantity).toBe(2);
    expect(adj[0].notes).toContain("expected 5, counted 3");
    expect(adj[0].notes).toContain("box was open");

    const count = await s.prisma.truckCount.findUnique({ where: { id: countId } });
    expect(count?.status).toBe("APPLIED");
    expect(count?.reviewedById).toBe(s.manager.id);
  });

  it("won't submit with blank lines, and an overage adds stock when applied", async () => {
    mockAuthAs({ id: s.manager.id, role: "MANAGER" });
    const list = await import("@/app/api/truck-counts/route");
    const countId = (await (await list.POST(await jsonRequest("/api/truck-counts", "POST", { truckId: s.truck.id }))).json()).count.id as string;

    const submit = await import("@/app/api/truck-counts/[id]/submit/route");
    const blank = await submit.POST(await jsonRequest(`/api/truck-counts/${countId}/submit`, "POST"), { params: { id: countId } });
    expect(blank.status).toBe(400);

    const detail = await import("@/app/api/truck-counts/[id]/route");
    await detail.PATCH(
      await jsonRequest(`/api/truck-counts/${countId}`, "PATCH", {
        lines: [
          { partId: s.capacitor.id, countedQty: 6 },
          { partId: s.filter.id, countedQty: 2 },
        ],
      }),
      { params: { id: countId } }
    );
    const review = await import("@/app/api/truck-counts/[id]/review/route");
    const applied = await review.POST(await jsonRequest(`/api/truck-counts/${countId}/review`, "POST", { decision: "APPLY" }), { params: { id: countId } });
    expect(applied.status).toBe(200);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(6);
    const adj = await s.prisma.inventoryTransaction.findFirst({ where: { type: "ADJUSTMENT" } });
    expect(adj?.toTruckId).toBe(s.truck.id);
  });
});
