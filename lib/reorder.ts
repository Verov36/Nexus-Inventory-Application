import { prisma } from "@/lib/prisma";
import { money, toNumber } from "@/lib/money";

/**
 * How many to order when a part is at or under its reorder point. A
 * manager-set reorderQty wins; otherwise bring it back to twice the
 * threshold (a common "min/max" rule of thumb), never less than 1.
 */
export function suggestOrderQty(quantity: number, reorderThreshold: number, reorderQty: number): number {
  if (reorderQty > 0) return reorderQty;
  return Math.max(1, reorderThreshold * 2 - quantity);
}

export type ReorderItem = {
  partId: string;
  sku: string;
  name: string;
  category: string | null;
  supplier: string | null;
  supplierPartNumber: string | null;
  quantity: number;
  reorderThreshold: number;
  reorderQty: number;
  suggestedQty: number;
  unitCost: number | null;
  estimatedCost: number;
  orderedAt: Date | null;
  orderedQty: number | null;
  orderedBy: string | null;
};

/**
 * Every part at or below its reorder point. Parts with no reorder point
 * (threshold 0) aren't listed — the count of those is returned separately
 * so the page can nudge someone to set them.
 */
export async function getReorderList(): Promise<{ items: ReorderItem[]; noReorderPoint: number }> {
  const parts = await prisma.part.findMany({
    include: { stockLevels: { where: { locationType: "WAREHOUSE" }, select: { quantity: true } } },
    orderBy: [{ supplier: "asc" }, { name: "asc" }],
  });

  const orderedByIds = Array.from(new Set(parts.map((p) => p.orderedById).filter((id): id is string => !!id)));
  const users = orderedByIds.length
    ? await prisma.user.findMany({ where: { id: { in: orderedByIds } }, select: { id: true, name: true } })
    : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const items: ReorderItem[] = [];
  let noReorderPoint = 0;
  for (const part of parts) {
    const quantity = part.stockLevels.reduce((sum, sl) => sum + sl.quantity, 0);
    if (part.reorderThreshold <= 0) {
      noReorderPoint++;
      continue;
    }
    if (quantity > part.reorderThreshold) continue;
    const suggestedQty = suggestOrderQty(quantity, part.reorderThreshold, part.reorderQty);
    const unitCost = part.unitCost === null ? null : toNumber(part.unitCost);
    items.push({
      partId: part.id,
      sku: part.sku,
      name: part.name,
      category: part.category,
      supplier: part.supplier?.trim() || null,
      supplierPartNumber: part.supplierPartNumber?.trim() || null,
      quantity,
      reorderThreshold: part.reorderThreshold,
      reorderQty: part.reorderQty,
      suggestedQty,
      unitCost,
      estimatedCost: unitCost === null ? 0 : money(suggestedQty * unitCost),
      orderedAt: part.orderedAt,
      orderedQty: part.orderedQty,
      orderedBy: part.orderedById ? userName.get(part.orderedById) ?? null : null,
    });
  }

  return { items, noReorderPoint };
}
