import { describe, expect, it } from "vitest";
import { formatMoney, money, toNumber } from "@/lib/money";
import { suggestOrderQty } from "@/lib/reorder";
import { summarizeCount } from "@/lib/truck-counts";

describe("money helpers", () => {
  it("turns Decimal-ish values into numbers and treats missing as 0", () => {
    expect(toNumber("12.50")).toBe(12.5);
    expect(toNumber(3)).toBe(3);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("")).toBe(0);
    expect(toNumber("abc")).toBe(0);
    expect(toNumber({ toString: () => "7.25" })).toBe(7.25);
  });

  it("rounds to cents without float drift", () => {
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(19.99 * 3)).toBe(59.97); // 59.97000000000001 in floating point
    expect(money(12.345)).toBe(12.35);
    expect(money(-2.5)).toBe(-2.5);
  });

  it("formats as USD", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(0)).toBe("$0.00");
  });
});

describe("suggestOrderQty", () => {
  it("uses the manager-set reorder quantity when there is one", () => {
    expect(suggestOrderQty(2, 5, 24)).toBe(24);
  });
  it("otherwise brings stock back to twice the threshold, never below 1", () => {
    expect(suggestOrderQty(2, 5, 0)).toBe(8);
    expect(suggestOrderQty(0, 5, 0)).toBe(10);
    expect(suggestOrderQty(5, 5, 0)).toBe(5);
    expect(suggestOrderQty(9, 5, 0)).toBe(1);
  });
});

describe("summarizeCount", () => {
  const lines = [
    { partId: "a", expectedQty: 5, countedQty: 3, part: { unitCost: "10.00" } },
    { partId: "b", expectedQty: 2, countedQty: 4, part: { unitCost: "2.50" } },
    { partId: "c", expectedQty: 1, countedQty: 1, part: { unitCost: null } },
    { partId: "d", expectedQty: 7, countedQty: null, part: { unitCost: "1.00" } },
  ];

  it("computes per-line variance and value, and totals", () => {
    const s = summarizeCount(lines);
    expect(s.totalLines).toBe(4);
    expect(s.countedLines).toBe(3);
    expect(s.uncountedLines).toBe(1);
    expect(s.unitsShort).toBe(2);
    expect(s.unitsOver).toBe(2);
    expect(s.varianceValue).toBe(-20 + 5);
    expect(s.lines.map((l) => l.variance)).toEqual([-2, 2, 0, null]);
    expect(s.lines[0].varianceValue).toBe(-20);
    expect(s.lines[3].varianceValue).toBe(0);
  });

  it("handles an empty count", () => {
    const s = summarizeCount([]);
    expect(s.totalLines).toBe(0);
    expect(s.varianceValue).toBe(0);
  });
});
