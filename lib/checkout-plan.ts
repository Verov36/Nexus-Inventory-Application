// Pure decision logic for a checkout, separated from the database so it can
// be unit-tested without Postgres. Given what's on hand and the caps that
// apply, decide which lines are blocked outright, which need a
// justification, and which just go through.

export type CheckoutType = "JOB_USE" | "RESTOCK";

export type PlanLine = {
  partId: string;
  sku: string;
  name: string;
  quantity: number;
  warehouseQty: number;
  truckQty: number;
  /** Applicable cap for this part on this truck, or null when uncapped. */
  limit: number | null;
};

export type InsufficientLine = { partId: string; sku: string; name: string; available: number; requested: number };
export type OverCapLine = {
  partId: string;
  sku: string;
  name: string;
  currentTruckQty: number;
  projectedQty: number;
  limit: number;
};

export type CheckoutPlan = {
  insufficient: InsufficientLine[];
  overCap: OverCapLine[];
  /** True when the over-cap lines block the whole checkout (RESTOCK). */
  blockedByCap: boolean;
  /** True when the over-cap lines can proceed with a justification (JOB_USE). */
  needsJustification: boolean;
};

/** Sums duplicate part lines and drops non-positive quantities. */
export function mergeLines<T extends { partId: string; quantity: number }>(items: T[]): T[] {
  const byPart = new Map<string, T>();
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) continue;
    const existing = byPart.get(item.partId);
    if (existing) existing.quantity += item.quantity;
    else byPart.set(item.partId, { ...item });
  }
  return Array.from(byPart.values());
}

export function planCheckout(lines: PlanLine[], checkoutType: CheckoutType): CheckoutPlan {
  const insufficient: InsufficientLine[] = [];
  const overCap: OverCapLine[] = [];

  for (const line of lines) {
    if (line.warehouseQty < line.quantity) {
      insufficient.push({
        partId: line.partId,
        sku: line.sku,
        name: line.name,
        available: Math.max(0, line.warehouseQty),
        requested: line.quantity,
      });
    }
    const projectedQty = line.truckQty + line.quantity;
    if (line.limit !== null && projectedQty > line.limit) {
      overCap.push({
        partId: line.partId,
        sku: line.sku,
        name: line.name,
        currentTruckQty: line.truckQty,
        projectedQty,
        limit: line.limit,
      });
    }
  }

  return {
    insufficient,
    overCap,
    // Restocking is exactly what fills the truck up to its cap — no
    // justification path, the cap is the cap.
    blockedByCap: checkoutType === "RESTOCK" && overCap.length > 0,
    needsJustification: checkoutType === "JOB_USE" && overCap.length > 0,
  };
}

export function describeOverCap(lines: OverCapLine[]): string {
  if (lines.length === 1) {
    const l = lines[0];
    return `This truck is already at ${l.currentTruckQty} of ${l.name} against a cap of ${l.limit}. Explain what jobs the current stock is accounted for on before checking out more.`;
  }
  const names = lines.map((l) => `${l.name} (${l.currentTruckQty}/${l.limit})`).join(", ");
  return `This truck would go over its cap on ${lines.length} parts: ${names}. Explain what jobs the current stock is accounted for on before checking out more.`;
}
