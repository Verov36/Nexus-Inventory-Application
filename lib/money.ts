// Prisma returns Decimal columns as Decimal objects on the server and as
// strings once they've been through JSON. Both need to become a plain number
// before any arithmetic, and a missing cost must count as 0, not NaN.
export function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? n : 0;
}

/** Money to two decimals, avoiding float drift like 0.1 + 0.2. */
export function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
