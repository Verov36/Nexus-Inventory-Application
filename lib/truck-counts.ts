import { prisma } from "@/lib/prisma";
import { canCheckoutToTruck, canManageTrucksAndLimits } from "@/lib/roles";
import { money, toNumber } from "@/lib/money";

export const countInclude = {
  truck: { select: { id: true, label: true, active: true, techId: true, tech: { select: { name: true } } } },
  startedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  lines: {
    include: { part: { select: { id: true, sku: true, name: true, category: true, unitCost: true } } },
    orderBy: { part: { name: "asc" as const } },
  },
} as const;

/** Who may work on a truck's counts: managers/admins any truck, a tech only their own. */
export function canWorkTruck(role: string | null | undefined, userId: string, truck: { techId: string | null }) {
  if (canManageTrucksAndLimits(role)) return true;
  return canCheckoutToTruck(role) && truck.techId === userId;
}

/** Summarises a count's lines: variance per line and totals, for both the API and the pages. */
export function summarizeCount<
  L extends { expectedQty: number; countedQty: number | null; part: { unitCost: unknown } },
>(lines: L[]) {
  let counted = 0;
  let short = 0;
  let over = 0;
  let varianceValue = 0;
  const detailed = lines.map((l) => {
    const variance = l.countedQty === null ? null : l.countedQty - l.expectedQty;
    if (l.countedQty !== null) counted++;
    if (variance !== null && variance < 0) short += -variance;
    if (variance !== null && variance > 0) over += variance;
    const unitCost = toNumber(l.part.unitCost);
    const value = variance === null ? 0 : money(variance * unitCost);
    varianceValue += value;
    return { ...l, variance, varianceValue: value };
  });
  return {
    lines: detailed,
    totalLines: lines.length,
    countedLines: counted,
    uncountedLines: lines.length - counted,
    unitsShort: short,
    unitsOver: over,
    varianceValue: money(varianceValue),
  };
}

export async function loadCount(id: string) {
  return prisma.truckCount.findUnique({ where: { id }, include: countInclude });
}
