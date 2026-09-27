// Prisma returns Decimal columns as Decimal objects on the server and as
// strings once they've been through JSON. Both need to become a plain number
// before any arithmetic, and a missing cost must count as 0, not NaN.
export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Money to two decimals, half away from zero (1.005 -> 1.01, -2.345 -> -2.35).
 * The tiny epsilon absorbs float representation error — 1.005 is stored as
 * 1.00499999…, which plain Math.round(x * 100) would round down.
 */
export function money(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-7)) / 100;
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
