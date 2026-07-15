import { prisma } from "@/lib/prisma";

export async function generateUsageSummary(from: Date, to: Date) {
  const rows = await prisma.inventoryTransaction.findMany({
    where: { type: "CHECKOUT", createdAt: { gte: from, lte: to } },
    include: {
      part: true,
      performedBy: { select: { name: true } },
      partUsage: { include: { job: true } },
      justification: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const jobUse = rows.filter((r) => r.checkoutType === "JOB_USE");
  const restock = rows.filter((r) => r.checkoutType === "RESTOCK");

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    totalCheckouts: rows.length,
    jobUseCount: jobUse.length,
    restockCount: restock.length,
    flaggedOverages: rows.filter((r) => r.justification && r.justification.status === "PENDING").length,
    byTech: groupBy(rows, (r) => r.performedBy.name).map(([tech, items]) => ({
      tech,
      partsCheckedOut: items.reduce((sum, i) => sum + i.quantity, 0),
      jobUseCount: items.filter((i) => i.checkoutType === "JOB_USE").length,
      restockCount: items.filter((i) => i.checkoutType === "RESTOCK").length,
    })),
    byPart: groupBy(rows, (r) => r.part.id).map(([, items]) => ({
      sku: items[0].part.sku,
      part: items[0].part.name,
      quantity: items.reduce((sum, i) => sum + i.quantity, 0),
    })),
    byJob: groupBy(
      rows.filter((r) => r.partUsage),
      (r) => r.partUsage!.job.jobNumber
    ).map(([jobNumber, items]) => ({
      jobNumber,
      parts: items.map((i) => ({ sku: i.part.sku, part: i.part.name, quantity: i.quantity })),
    })),
  };
}

export async function getTransactionRows(from: Date, to: Date) {
  return prisma.inventoryTransaction.findMany({
    where: { type: "CHECKOUT", createdAt: { gte: from, lte: to } },
    include: {
      part: true,
      performedBy: { select: { name: true } },
      partUsage: { include: { job: true } },
      justification: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return Array.from(map.entries());
}
