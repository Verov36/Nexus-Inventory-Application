import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/** Current warehouse quantity for a part (across the one warehouse row that has truckId null). */
export async function getWarehouseStock(partId: string, warehouseId: string) {
  return prisma.stockLevel.findFirst({
    where: { partId, warehouseId, truckId: null },
  });
}

/** Current truck quantity for a part. */
export async function getTruckStock(partId: string, truckId: string) {
  return prisma.stockLevel.findFirst({
    where: { partId, truckId, warehouseId: null },
  });
}

/** Adjusts (or creates) a warehouse stock row by a signed delta. Must run inside a transaction. */
export async function adjustWarehouseStock(
  tx: Prisma.TransactionClient,
  partId: string,
  warehouseId: string,
  delta: number
) {
  const existing = await tx.stockLevel.findFirst({ where: { partId, warehouseId, truckId: null } });
  if (existing) {
    return tx.stockLevel.update({ where: { id: existing.id }, data: { quantity: { increment: delta } } });
  }
  return tx.stockLevel.create({
    data: { partId, warehouseId, locationType: "WAREHOUSE", quantity: Math.max(delta, 0) },
  });
}

/** Adjusts (or creates) a truck stock row by a signed delta. Must run inside a transaction. */
export async function adjustTruckStock(
  tx: Prisma.TransactionClient,
  partId: string,
  truckId: string,
  delta: number
) {
  const existing = await tx.stockLevel.findFirst({ where: { partId, truckId, warehouseId: null } });
  if (existing) {
    return tx.stockLevel.update({ where: { id: existing.id }, data: { quantity: { increment: delta } } });
  }
  return tx.stockLevel.create({
    data: { partId, truckId, locationType: "TRUCK", quantity: Math.max(delta, 0) },
  });
}

/** Finds the applicable stock limit for a part on a truck: exact part match wins over category match. */
export async function getApplicableLimit(truckId: string, partId: string, category: string | null) {
  const partLimit = await prisma.truckStockLimit.findFirst({ where: { truckId, partId } });
  if (partLimit) return partLimit;
  if (category) {
    return prisma.truckStockLimit.findFirst({ where: { truckId, category, partId: null } });
  }
  return null;
}

export async function findOrCreateJob(jobNumber: string) {
  return prisma.job.upsert({
    where: { jobNumber },
    update: {},
    create: { jobNumber },
  });
}
