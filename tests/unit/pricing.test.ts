import { describe, expect, it } from "vitest";
import { priceFor } from "@/lib/pricing";
import { money } from "@/lib/money";

describe("priceFor", () => {
  it("uses the part's list price when it has one", () => {
    expect(priceFor({ unitCost: "10.00", listPrice: "19.99" }, 25)).toEqual({ unitPrice: 19.99, source: "list" });
  });

  it("otherwise charges cost plus the company markup", () => {
    expect(priceFor({ unitCost: "12.50", listPrice: null }, 25)).toEqual({ unitPrice: 15.63, source: "markup" });
    expect(priceFor({ unitCost: "4.00", listPrice: null }, "40.00")).toEqual({ unitPrice: 5.6, source: "markup" });
  });

  it("a free list price is a real price, not 'no price'", () => {
    expect(priceFor({ unitCost: "3.00", listPrice: "0" }, 25)).toEqual({ unitPrice: 0, source: "list" });
  });

  it("with no cost and no list price there's no price, never a guessed $0", () => {
    expect(priceFor({ unitCost: null, listPrice: null }, 25)).toEqual({ unitPrice: null, source: null });
  });
});

describe("money rounding", () => {
  it("rounds half away from zero despite float representation", () => {
    expect(money(1.005)).toBe(1.01);
    expect(money(2.675)).toBe(2.68);
    expect(money(-2.345)).toBe(-2.35);
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money(-0.004)).toBe(-0);
  });
});
