import { prisma } from "@/lib/prisma";
import { money, toNumber } from "@/lib/money";

// `to` is exclusive — callers pass the start of the day *after* the last day
// they want included, so a whole final day is never silently dropped.
export async function generateUsageSummary(from: Date, to: Date) {
  const rows = await getTransactionRows(from, to);

  const jobUse = rows.filter((r) => r.checkoutType === "JOB_USE");
  const restock = rows.filter((r) => r.checkoutType === "RESTOCK");
  const lineCost = (r: (typeof rows)[number]) => money(r.quantity * toNumber(r.part.unitCost));
  const sumCost = (items: typeof rows) => money(items.reduce((sum, i) => sum + lineCost(i), 0));

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    totalCheckouts: rows.length,
    jobUseCount: jobUse.length,
    restockCount: restock.length,
    flaggedOverages: rows.filter((r) => r.justification && r.justification.status === "PENDING").length,
    // Parts cost, using each part's current unit cost. Lines whose part has
    // no cost on file count as $0 and are reported so nobody mistakes a
    // low total for a cheap week.
    totalCost: sumCost(rows),
    jobUseCost: sumCost(jobUse),
    restockCost: sumCost(restock),
    uncostedLines: rows.filter((r) => r.part.unitCost === null).length,
    byTech: groupBy(rows, (r) => r.performedBy.name).map(([tech, items]) => ({
      tech,
      partsCheckedOut: items.reduce((sum, i) => sum + i.quantity, 0),
      jobUseCount: items.filter((i) => i.checkoutType === "JOB_USE").length,
      restockCount: items.filter((i) => i.checkoutType === "RESTOCK").length,
      cost: sumCost(items),
    })),
    byPart: groupBy(rows, (r) => r.part.id)
      .map(([, items]) => ({
        sku: items[0].part.sku,
        part: items[0].part.name,
        quantity: items.reduce((sum, i) => sum + i.quantity, 0),
        unitCost: items[0].part.unitCost === null ? null : toNumber(items[0].part.unitCost),
        cost: sumCost(items),
      }))
      .sort((a, b) => b.cost - a.cost || b.quantity - a.quantity),
    byJob: groupBy(
      rows.filter((r) => r.partUsage),
      (r) => r.partUsage!.job.jobNumber
    ).map(([jobNumber, items]) => ({
      jobNumber,
      customer: items[0].partUsage!.job.customer,
      cost: sumCost(items),
      parts: items.map((i) => ({
        sku: i.part.sku,
        part: i.part.name,
        quantity: i.quantity,
        unitCost: i.part.unitCost === null ? null : toNumber(i.part.unitCost),
        cost: lineCost(i),
      })),
    })),
  };
}

export type UsageSummary = Awaited<ReturnType<typeof generateUsageSummary>>;

export async function getTransactionRows(from: Date, to: Date) {
  return prisma.inventoryTransaction.findMany({
    where: { type: "CHECKOUT", createdAt: { gte: from, lt: to } },
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
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return Array.from(map.entries());
}
