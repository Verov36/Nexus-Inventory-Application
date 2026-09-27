import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "@/lib/csv";

describe("csvCell", () => {
  it("quotes and escapes", () => {
    expect(csvCell('Filter "16x25"')).toBe('"Filter ""16x25"""');
    expect(csvCell(null)).toBe('""');
  });

  it("neutralizes spreadsheet formulas", () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell("+1+cmd|' /C calc'!A0")).toMatch(/^"'\+/);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("\tx")).toBe(`"'\tx"`);
  });

  it("leaves real numbers alone, including negatives", () => {
    expect(csvRow([-3, "-12.50", 4])).toBe('"-3","-12.50","4"');
  });
});
