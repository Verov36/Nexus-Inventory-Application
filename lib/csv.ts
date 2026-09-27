// CSV cells for files people open in Excel / Sheets. Values are quoted, and
// any cell a spreadsheet would treat as a formula (leading = + - @ tab or CR)
// is prefixed with an apostrophe, so a job number or part name typed as
// =HYPERLINK(...) shows up as text instead of running.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  // Plain numbers (including negatives like -3) are data, not formulas.
  if (FORMULA_START.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}
