import { beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, resetDatabase, seedBasics, truckQty, warehouseQty, type Seeded } from "./setup";

describe.skipIf(!hasDatabase)("performCheckout (real database)", () => {
  let s: Seeded;

  beforeEach(async () => {
    await resetDatabase();
    s = await seedBasics();
  });

  async function checkout(overrides: Record<string, unknown> = {}) {
    const { performCheckout } = await import("@/lib/checkout");
    return performCheckout({
      userId: s.tech.id,
      role: "TRUCK_TECH",
      truckId: s.truck.id,
      warehouseId: s.warehouse.id,
      checkoutType: "JOB_USE",
      jobNumber: "WO-100",
      items: [{ partId: s.capacitor.id, quantity: 2 }],
      ...overrides,
    });
  }

  it("moves stock from the warehouse to the truck and records the job", async () => {
    const result = await checkout();
    expect(result.ok).toBe(true);
    expect(await warehouseQty(s.capacitor.id, s.warehouse.id)).toBe(8);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(2);

    const tx = await s.prisma.inventoryTransaction.findMany({ include: { partUsage: { include: { job: true } } } });
    expect(tx).toHaveLength(1);
    expect(tx[0].type).toBe("CHECKOUT");
    expect(tx[0].checkoutType).toBe("JOB_USE");
    expect(tx[0].partUsage?.job.jobNumber).toBe("WO-100");
  });

  it("checks out a whole cart in one go, merging duplicate lines", async () => {
    const result = await checkout({
      items: [
        { partId: s.capacitor.id, quantity: 1 },
        { partId: s.filter.id, quantity: 5 },
        { partId: s.capacitor.id, quantity: 2 },
      ],
    });
    expect(result.ok).toBe(true);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(3);
    expect(await truckQty(s.filter.id, s.truck.id)).toBe(5);
    expect(await warehouseQty(s.filter.id, s.warehouse.id)).toBe(15);
    expect(await s.prisma.inventoryTransaction.count()).toBe(2);
  });

  it("refuses when the warehouse can't cover a line, and moves nothing", async () => {
    const result = await checkout({
      items: [
        { partId: s.filter.id, quantity: 1 },
        { partId: s.capacitor.id, quantity: 11 },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.body.insufficient).toEqual([expect.objectContaining({ partId: s.capacitor.id, available: 10, requested: 11 })]);
    expect(await warehouseQty(s.filter.id, s.warehouse.id)).toBe(20);
    expect(await s.prisma.inventoryTransaction.count()).toBe(0);
  });

  it("requires a job number for job checkouts", async () => {
    const result = await checkout({ jobNumber: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("only lets a tech load their own truck; an admin can load any; a manager can't check out at all", async () => {
    const asTech = await checkout({ truckId: s.otherTruck.id });
    expect(asTech.ok).toBe(false);
    if (!asTech.ok) expect(asTech.status).toBe(403);

    // Managers set caps and review justifications; loading trucks isn't
    // their role (see canCheckoutToTruck in lib/roles.ts).
    const asManager = await checkout({ truckId: s.otherTruck.id, userId: s.manager.id, role: "MANAGER" });
    expect(asManager.ok).toBe(false);
    if (!asManager.ok) expect(asManager.status).toBe(403);

    const asAdmin = await checkout({ truckId: s.otherTruck.id, userId: s.manager.id, role: "ADMIN" });
    expect(asAdmin.ok).toBe(true);
    expect(await truckQty(s.capacitor.id, s.otherTruck.id)).toBe(2);
  });

  it("refuses a deactivated truck and a role that can't check out", async () => {
    await s.prisma.truck.update({ where: { id: s.truck.id }, data: { active: false } });
    const inactive = await checkout();
    expect(inactive.ok).toBe(false);
    if (!inactive.ok) expect(inactive.status).toBe(409);

    const warehouseGuy = await checkout({ role: "WAREHOUSE_EMPLOYEE" });
    expect(warehouseGuy.ok).toBe(false);
    if (!warehouseGuy.ok) expect(warehouseGuy.status).toBe(403);
  });

  describe("caps", () => {
    beforeEach(async () => {
      await s.prisma.truckStockLimit.create({
        data: { truckId: s.truck.id, partId: s.capacitor.id, maxQty: 3, setById: s.manager.id },
      });
      await s.prisma.truckStockLimit.create({
        data: { truckId: s.truck.id, category: "Filters", maxQty: 4, setById: s.manager.id },
      });
    });

    it("blocks a restock that would exceed a part cap", async () => {
      const result = await checkout({ checkoutType: "RESTOCK", jobNumber: undefined, items: [{ partId: s.capacitor.id, quantity: 4 }] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(409);
        expect(result.body.overCap).toEqual([expect.objectContaining({ projectedQty: 4, limit: 3 })]);
      }
      expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(0);
    });

    it("applies a category cap to a part with no part-level cap", async () => {
      const result = await checkout({ checkoutType: "RESTOCK", jobNumber: undefined, items: [{ partId: s.filter.id, quantity: 5 }] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.body.overCap).toEqual([expect.objectContaining({ partId: s.filter.id, limit: 4 })]);
    });

    it("asks for a justification on an over-cap job checkout, then files it and proceeds", async () => {
      const first = await checkout({ items: [{ partId: s.capacitor.id, quantity: 4 }] });
      expect(first.ok).toBe(false);
      if (!first.ok) {
        expect(first.body.requiresJustification).toBe(true);
        expect(first.body.overCap).toHaveLength(1);
      }
      expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(0);

      const second = await checkout({
        items: [
          { partId: s.capacitor.id, quantity: 4 },
          { partId: s.filter.id, quantity: 1 },
        ],
        justification: { explanation: "Three jobs on the board today", relatedJobNumbers: ["WO-98", "WO-99"] },
      });
      expect(second.ok).toBe(true);
      expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(4);

      // Only the over-cap line gets a justification, not the filter.
      const justifications = await s.prisma.overageJustification.findMany({ include: { transaction: true } });
      expect(justifications).toHaveLength(1);
      expect(justifications[0].status).toBe("PENDING");
      expect(justifications[0].transaction?.partId).toBe(s.capacitor.id);
      expect(justifications[0].relatedJobNumbers).toEqual(["WO-98", "WO-99"]);
    });
  });

  it("never overdraws the warehouse under concurrent checkouts", async () => {
    await s.prisma.stockLevel.updateMany({ where: { partId: s.capacitor.id }, data: { quantity: 1 } });
    const attempts = await Promise.all([
      checkout({ items: [{ partId: s.capacitor.id, quantity: 1 }], jobNumber: "A" }),
      checkout({ items: [{ partId: s.capacitor.id, quantity: 1 }], jobNumber: "B" }),
      checkout({ items: [{ partId: s.capacitor.id, quantity: 1 }], jobNumber: "C" }),
    ]);
    const successes = attempts.filter((a) => a.ok).length;
    expect(successes).toBe(1);
    expect(await warehouseQty(s.capacitor.id, s.warehouse.id)).toBe(0);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(1);
    for (const a of attempts) if (!a.ok) expect(a.status).toBe(409);
  });
});
