import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Thrown from inside a stock-adjusting transaction when a removal would take
 * a location below zero. Every stock check the API does *before* opening the
 * transaction is only advisory — two techs scanning the same part at the same
 * moment both pass it — so the transaction itself has to be the thing that
 * refuses to overdraw. Callers catch this and turn it into a 409.
 */
export class InsufficientStockError extends Error {
  constructor(public readonly available: number, public readonly requested: number) {
    super(`Only ${available} available, ${requested} requested`);
    this.name = "InsufficientStockError";
  }
}

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

/**
 * Resolves which warehouse an action should hit. Accepts the id the client
 * sent (from NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID), but falls back to
 * DEFAULT_WAREHOUSE_ID on the server and finally to the only/first warehouse
 * in the database — so a deployment where the public env var wasn't baked
 * into the client bundle still works instead of failing every receive,
 * checkout, and return with "warehouse not found".
 */
export async function resolveWarehouseId(requested?: string | null) {
  const candidates = [requested, process.env.DEFAULT_WAREHOUSE_ID, process.env.NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID]
    .map((c) => c?.trim())
    .filter((c): c is string => !!c);

  for (const id of candidates) {
    const warehouse = await prisma.warehouse.findUnique({ where: { id }, select: { id: true } });
    if (warehouse) return warehouse.id;
  }

  const first = await prisma.warehouse.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  return first?.id ?? null;
}

async function applyDelta(
  tx: Prisma.TransactionClient,
  where: { partId: string; warehouseId?: string; truckId?: string },
  create: Prisma.StockLevelUncheckedCreateInput,
  delta: number
) {
  const existing = await tx.stockLevel.findFirst({
    where: { partId: where.partId, warehouseId: where.warehouseId ?? null, truckId: where.truckId ?? null },
  });

  if (!existing) {
    if (delta < 0) throw new InsufficientStockError(0, -delta);
    return tx.stockLevel.create({ data: { ...create, quantity: delta } });
  }

  if (delta < 0) {
    // Conditional decrement: only succeeds if there's still enough on hand
    // at the moment the row is locked, which is what makes concurrent
    // checkouts of the same part safe.
    const result = await tx.stockLevel.updateMany({
      where: { id: existing.id, quantity: { gte: -delta } },
      data: { quantity: { increment: delta } },
    });
    if (result.count === 0) {
      const fresh = await tx.stockLevel.findUnique({ where: { id: existing.id } });
      throw new InsufficientStockError(fresh?.quantity ?? 0, -delta);
    }
    return tx.stockLevel.findUniqueOrThrow({ where: { id: existing.id } });
  }

  return tx.stockLevel.update({ where: { id: existing.id }, data: { quantity: { increment: delta } } });
}

/** Adjusts (or creates) a warehouse stock row by a signed delta. Must run inside a transaction. */
export async function adjustWarehouseStock(
  tx: Prisma.TransactionClient,
  partId: string,
  warehouseId: string,
  delta: number
) {
  return applyDelta(
    tx,
    { partId, warehouseId },
    { partId, warehouseId, locationType: "WAREHOUSE", quantity: 0 },
    delta
  );
}

/** Adjusts (or creates) a truck stock row by a signed delta. Must run inside a transaction. */
export async function adjustTruckStock(
  tx: Prisma.TransactionClient,
  partId: string,
  truckId: string,
  delta: number
) {
  return applyDelta(tx, { partId, truckId }, { partId, truckId, locationType: "TRUCK", quantity: 0 }, delta);
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

export async function findOrCreateJob(tx: Prisma.TransactionClient, jobNumber: string) {
  return tx.job.upsert({
    where: { jobNumber },
    update: {},
    create: { jobNumber },
  });
}
