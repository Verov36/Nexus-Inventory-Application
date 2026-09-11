import { describe, expect, it } from "vitest";
import { findApplicableLimit } from "@/lib/limits";

const limits = [
  { id: "cat-filters", partId: null, part: null, category: "Filters", maxQty: 10 },
  { id: "part-x", partId: "x", part: { id: "x" }, category: null, maxQty: 2 },
];

describe("findApplicableLimit", () => {
  it("prefers an exact part cap over the part's category cap", () => {
    expect(findApplicableLimit(limits, { id: "x", category: "Filters" })?.id).toBe("part-x");
  });

  it("falls back to the category cap, case-insensitively and ignoring whitespace", () => {
    expect(findApplicableLimit(limits, { id: "y", category: " filters " })?.id).toBe("cat-filters");
  });

  it("returns null when nothing applies", () => {
    expect(findApplicableLimit(limits, { id: "y", category: "Belts" })).toBeNull();
    expect(findApplicableLimit(limits, { id: "y", category: null })).toBeNull();
    expect(findApplicableLimit([], { id: "x", category: "Filters" })).toBeNull();
  });

  it("works with limits that carry only partId (no part relation loaded)", () => {
    const bare = [{ partId: "x", category: null, maxQty: 7 }];
    expect(findApplicableLimit(bare, { id: "x" })?.maxQty).toBe(7);
  });
});
