import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { adjustTruckStock, lockStockQty } from "@/lib/inventory";
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

type LoadedCount = NonNullable<Awaited<ReturnType<typeof loadCount>>>;

/**
 * A count as the API returns it. Blind for techs while it's OPEN: they enter
 * what they see without being told what the system expects, which is what
 * makes a count worth anything. Once submitted the numbers are visible to
 * everyone involved.
 */
export function presentCount(count: LoadedCount, role: string | undefined) {
  const summary = summarizeCount(count.lines);
  const showExpected = canManageTrucksAndLimits(role) || count.status !== "OPEN";
  return {
    ...count,
    ...summary,
    lines: summary.lines.map((l) =>
      showExpected ? l : { ...l, expectedQty: null, variance: null, varianceValue: null }
    ),
    unitsShort: showExpected ? summary.unitsShort : null,
    unitsOver: showExpected ? summary.unitsOver : null,
    varianceValue: showExpected ? summary.varianceValue : null,
  };
}

/** The count isn't in the state the caller expected (someone else got there first). */
export class CountStateConflict extends Error {}

/**
 * Posts a SUBMITTED count to the truck. Must run in a transaction.
 *
 * Claims the count first (SUBMITTED → APPLIED in one conditional update), so a
 * double-click or two managers applying at once post it exactly once.
 *
 * For each line, sets the truck to what was physically counted *plus* the
 * net stock that moved on or off the truck after that line was counted — the
 * truck row is locked while this is worked out. So a checkout or return that
 * happened while the count was open is neither double-counted nor lost, and
 * the posted adjustment is the real shrink or overage.
 */
export async function applyCount(tx: Prisma.TransactionClient, countId: string, reviewerId: string) {
  const claimed = await tx.truckCount.updateMany({
    where: { id: countId, status: "SUBMITTED" },
    data: { status: "APPLIED", reviewedById: reviewerId, reviewedAt: new Date() },
  });
  if (claimed.count === 0) throw new CountStateConflict();

  const count = await tx.truckCount.findUniqueOrThrow({
    where: { id: countId },
    include: { lines: { orderBy: { partId: "asc" } } }, // fixed lock order: no deadlocks with other writers
  });

  const posted: { partId: string; delta: number; movedSince: number }[] = [];
  for (const line of count.lines) {
    if (line.countedQty === null) throw new CountStateConflict();
    const current = await lockStockQty(tx, line.partId, { truckId: count.truckId });
    const countedAt = line.countedAt ?? count.submittedAt ?? count.createdAt;

    const [onto, offOf] = await Promise.all([
      tx.inventoryTransaction.aggregate({
        _sum: { quantity: true },
        where: { partId: line.partId, toTruckId: count.truckId, createdAt: { gt: countedAt } },
      }),
      tx.inventoryTransaction.aggregate({
        _sum: { quantity: true },
        where: { partId: line.partId, fromTruckId: count.truckId, createdAt: { gt: countedAt } },
      }),
    ]);
    const movedSince = (onto._sum.quantity ?? 0) - (offOf._sum.quantity ?? 0);
    // Can't go below zero: more left the truck after the count than was
    // counted means the count itself was short — nothing's left to adjust.
    const target = Math.max(0, line.countedQty + movedSince);
    const delta = target - current;

    await tx.truckCountLine.update({ where: { id: line.id }, data: { appliedDelta: delta } });
    if (delta === 0) continue;

    await adjustTruckStock(tx, line.partId, count.truckId, delta);
    await tx.inventoryTransaction.create({
      data: {
        type: "ADJUSTMENT",
        partId: line.partId,
        quantity: Math.abs(delta),
        ...(delta < 0
          ? { fromLocationType: "TRUCK", fromTruckId: count.truckId }
          : { toLocationType: "TRUCK", toTruckId: count.truckId }),
        performedById: reviewerId,
        notes: `Truck count ${count.createdAt.toISOString().slice(0, 10)}: expected ${line.expectedQty}, counted ${line.countedQty}${
          movedSince ? `, ${movedSince > 0 ? "+" : ""}${movedSince} moved during the count` : ""
        }${count.notes ? ` — ${count.notes}` : ""}`,
      },
    });
    posted.push({ partId: line.partId, delta, movedSince });
  }
  return posted;
}
