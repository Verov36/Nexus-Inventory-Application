import { describe, expect, it } from "vitest";
import { describeOverCap, mergeLines, planCheckout, type PlanLine } from "@/lib/checkout-plan";

const line = (over: Partial<PlanLine> = {}): PlanLine => ({
  partId: "p1",
  sku: "SKU-1",
  name: "Capacitor",
  quantity: 1,
  warehouseQty: 10,
  truckQty: 0,
  limit: null,
  ...over,
});

describe("mergeLines", () => {
  it("sums duplicate parts and drops non-positive quantities", () => {
    const merged = mergeLines([
      { partId: "a", quantity: 2 },
      { partId: "b", quantity: 0 },
      { partId: "a", quantity: 3 },
      { partId: "c", quantity: -1 },
      { partId: "d", quantity: 1.5 },
    ]);
    expect(merged).toEqual([{ partId: "a", quantity: 5 }]);
  });

  it("does not mutate the input objects", () => {
    const input = [{ partId: "a", quantity: 2 }, { partId: "a", quantity: 3 }];
    mergeLines(input);
    expect(input[0].quantity).toBe(2);
  });
});

describe("planCheckout", () => {
  it("passes a plain checkout with stock and no cap", () => {
    const plan = planCheckout([line()], "JOB_USE");
    expect(plan.insufficient).toEqual([]);
    expect(plan.overCap).toEqual([]);
    expect(plan.blockedByCap).toBe(false);
    expect(plan.needsJustification).toBe(false);
  });

  it("flags lines the warehouse can't cover, with what's actually available", () => {
    const plan = planCheckout([line({ quantity: 4, warehouseQty: 3 }), line({ partId: "p2", warehouseQty: -2, quantity: 1 })], "RESTOCK");
    expect(plan.insufficient).toEqual([
      expect.objectContaining({ partId: "p1", available: 3, requested: 4 }),
      expect.objectContaining({ partId: "p2", available: 0, requested: 1 }),
    ]);
  });

  it("allows landing exactly on the cap", () => {
    const plan = planCheckout([line({ truckQty: 3, quantity: 2, limit: 5 })], "RESTOCK");
    expect(plan.overCap).toEqual([]);
    expect(plan.blockedByCap).toBe(false);
  });

  it("blocks a restock that would exceed the cap — no justification path", () => {
    const plan = planCheckout([line({ truckQty: 3, quantity: 3, limit: 5 })], "RESTOCK");
    expect(plan.overCap).toEqual([expect.objectContaining({ currentTruckQty: 3, projectedQty: 6, limit: 5 })]);
    expect(plan.blockedByCap).toBe(true);
    expect(plan.needsJustification).toBe(false);
  });

  it("asks for a justification on an over-cap job checkout", () => {
    const plan = planCheckout([line({ truckQty: 5, quantity: 1, limit: 5 })], "JOB_USE");
    expect(plan.blockedByCap).toBe(false);
    expect(plan.needsJustification).toBe(true);
  });

  it("treats a cap of 0 as a real cap, not 'no cap'", () => {
    const plan = planCheckout([line({ limit: 0 })], "RESTOCK");
    expect(plan.blockedByCap).toBe(true);
  });

  it("evaluates every line independently in a cart", () => {
    const plan = planCheckout(
      [
        line({ partId: "ok" }),
        line({ partId: "short", warehouseQty: 0 }),
        line({ partId: "capped", truckQty: 2, quantity: 2, limit: 3 }),
      ],
      "JOB_USE"
    );
    expect(plan.insufficient.map((l) => l.partId)).toEqual(["short"]);
    expect(plan.overCap.map((l) => l.partId)).toEqual(["capped"]);
    expect(plan.needsJustification).toBe(true);
  });
});

describe("describeOverCap", () => {
  it("names the part for a single line and lists them for several", () => {
    const one = describeOverCap([{ partId: "a", sku: "A", name: "Contactor", currentTruckQty: 4, projectedQty: 5, limit: 4 }]);
    expect(one).toContain("4 of Contactor against a cap of 4");
    const many = describeOverCap([
      { partId: "a", sku: "A", name: "Contactor", currentTruckQty: 4, projectedQty: 5, limit: 4 },
      { partId: "b", sku: "B", name: "Fuse", currentTruckQty: 9, projectedQty: 12, limit: 10 },
    ]);
    expect(many).toContain("2 parts");
    expect(many).toContain("Fuse (9/10)");
  });
});
