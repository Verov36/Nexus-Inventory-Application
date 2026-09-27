import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { TEST_ORG, hasDatabase, jsonRequest, mockAuthAs, resetDatabase, seedBasics, truckQty, type Seeded } from "./setup";

// Parts used on a job: the only way stock leaves inventory for a customer.

describe.skipIf(!hasDatabase)("parts used on a job (real database)", () => {
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

  async function consume(body: Record<string, unknown>, key?: string) {
    const { POST } = await import("@/app/api/inventory/consume/route");
    const req = new NextRequest("http://localhost/api/inventory/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
      body: JSON.stringify(body),
    });
    return POST(req);
  }

  it("takes parts off the truck and costs them to the job", async () => {
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const res = await consume({
      truckId: s.truck.id,
      jobNumber: "J-1042",
      items: [
        { partId: s.capacitor.id, quantity: 2 },
        { partId: s.filter.id, quantity: 1 },
      ],
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.consumed).toHaveLength(2);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(3);
    expect(await truckQty(s.filter.id, s.truck.id)).toBe(1);

    const rows = await s.prisma.inventoryTransaction.findMany({
      where: { type: "CONSUME" },
      include: { partUsage: { include: { job: true } } },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.fromTruckId === s.truck.id && r.partUsage?.job.jobNumber === "J-1042")).toBe(true);

    // Job cost comes from what was used: 2 x $12.50 + 1 x $4.00.
    const { generateUsageSummary } = await import("@/lib/reports");
    const { runAsOrg } = await import("@/lib/tenant");
    const summary = await runAsOrg(TEST_ORG, () =>
      generateUsageSummary(new Date(Date.now() - 60_000), new Date(Date.now() + 60_000))
    );
    expect(summary.usedCost).toBe(29);
    expect(summary.byJob).toEqual([expect.objectContaining({ jobNumber: "J-1042", cost: 29 })]);
  });

  it("is all-or-nothing: one short line records nothing", async () => {
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const res = await consume({
      truckId: s.truck.id,
      jobNumber: "J-1",
      items: [
        { partId: s.capacitor.id, quantity: 1 },
        { partId: s.filter.id, quantity: 3 }, // only 2 on the truck
      ],
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Filter");
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(5);
    expect(await s.prisma.inventoryTransaction.count({ where: { type: "CONSUME" } })).toBe(0);
    expect(await s.prisma.job.count()).toBe(0);
  });

  it("a tech can't record parts from someone else's truck", async () => {
    mockAuthAs({ id: s.otherTech.id, role: "TRUCK_TECH" });
    const res = await consume({ truckId: s.truck.id, jobNumber: "J-1", items: [{ partId: s.capacitor.id, quantity: 1 }] });
    expect(res.status).toBe(403);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(5);
  });

  it("a retried request with the same key records the parts once", async () => {
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const body = { truckId: s.truck.id, jobNumber: "J-7", items: [{ partId: s.capacitor.id, quantity: 2 }] };
    const [a, b] = await Promise.all([consume(body, "retry-key-1"), consume(body, "retry-key-1")]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const replays = [(await a.json()).replayed, (await b.json()).replayed].sort();
    expect(replays).toEqual([false, true]);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(3);
    expect(await s.prisma.inventoryTransaction.count({ where: { type: "CONSUME" } })).toBe(1);

    // A new key is a new use.
    expect((await consume(body, "retry-key-2")).status).toBe(201);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(1);
  });

  it("two people using the last units at once can't overdraw the truck", async () => {
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const body = { truckId: s.truck.id, jobNumber: "J-9", items: [{ partId: s.filter.id, quantity: 2 }] };
    const statuses = (await Promise.all([consume(body), consume(body)])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(await truckQty(s.filter.id, s.truck.id)).toBe(0);
  });

  it("a count applied later accounts for parts used while it was open", async () => {
    // Count 5 capacitors, then use 2 on a job, then apply: truck ends at 3, no adjustment.
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const list = await import("@/app/api/truck-counts/route");
    const countId = (await (await list.POST(await jsonRequest("/api/truck-counts", "POST", { truckId: s.truck.id }))).json())
      .count.id as string;
    const p = { params: Promise.resolve({ id: countId }) };
    const detail = await import("@/app/api/truck-counts/[id]/route");
    await detail.PATCH(
      await jsonRequest(`/api/truck-counts/${countId}`, "PATCH", {
        lines: [
          { partId: s.capacitor.id, countedQty: 5 },
          { partId: s.filter.id, countedQty: 2 },
        ],
      }),
      p
    );
    await new Promise((r) => setTimeout(r, 5));
    expect((await consume({ truckId: s.truck.id, jobNumber: "J-2", items: [{ partId: s.capacitor.id, quantity: 2 }] })).status).toBe(201);
    const submit = await import("@/app/api/truck-counts/[id]/submit/route");
    await submit.POST(await jsonRequest(`/api/truck-counts/${countId}/submit`, "POST"), p);

    vi.resetModules();
    mockAuthAs({ id: s.manager.id, role: "MANAGER" });
    const review = await import("@/app/api/truck-counts/[id]/review/route");
    const applied = await review.POST(await jsonRequest(`/api/truck-counts/${countId}/review`, "POST", { decision: "APPLY" }), p);
    expect(applied.status).toBe(200);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(3);
    expect(await s.prisma.inventoryTransaction.count({ where: { type: "ADJUSTMENT" } })).toBe(0);
  });
});
