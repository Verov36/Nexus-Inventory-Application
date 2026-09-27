import { prisma } from "@/lib/prisma";
import { money, toNumber } from "@/lib/money";

// `to` is exclusive — callers pass the start of the day *after* the last day
// they want included, so a whole final day is never silently dropped.
//
// Two different things happen to parts on trucks and they're reported apart:
//   loaded — CHECKOUT, warehouse to truck (stock moves, nothing is spent)
//   used   — CONSUME, truck to a customer's job (this is the parts cost)
// Job costs come only from "used". Stored snapshots from before CONSUME
// existed have only the load fields; the page treats the used ones as optional.
export async function generateUsageSummary(from: Date, to: Date) {
  const all = await getTransactionRows(from, to);
  const rows = all.filter((r) => r.type === "CHECKOUT");
  const used = all.filter((r) => r.type === "CONSUME");

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
    uncostedLines: all.filter((r) => r.part.unitCost === null).length,
    usedLines: used.length,
    usedUnits: used.reduce((sum, i) => sum + i.quantity, 0),
    usedCost: sumCost(used),
    byTech: groupBy(all, (r) => r.performedBy.name).map(([tech, items]) => {
      const loads = items.filter((i) => i.type === "CHECKOUT");
      const uses = items.filter((i) => i.type === "CONSUME");
      return {
        tech,
        partsCheckedOut: loads.reduce((sum, i) => sum + i.quantity, 0),
        jobUseCount: loads.filter((i) => i.checkoutType === "JOB_USE").length,
        restockCount: loads.filter((i) => i.checkoutType === "RESTOCK").length,
        cost: sumCost(loads),
        partsUsed: uses.reduce((sum, i) => sum + i.quantity, 0),
        usedCost: sumCost(uses),
      };
    }),
    byPart: groupBy(all, (r) => r.part.id)
      .map(([, items]) => {
        const loads = items.filter((i) => i.type === "CHECKOUT");
        const uses = items.filter((i) => i.type === "CONSUME");
        return {
          sku: items[0].part.sku,
          part: items[0].part.name,
          quantity: loads.reduce((sum, i) => sum + i.quantity, 0),
          unitCost: items[0].part.unitCost === null ? null : toNumber(items[0].part.unitCost),
          cost: sumCost(loads),
          usedQuantity: uses.reduce((sum, i) => sum + i.quantity, 0),
          usedCost: sumCost(uses),
        };
      })
      .sort((a, b) => b.usedCost - a.usedCost || b.cost - a.cost || b.quantity - a.quantity),
    // What each job actually consumed.
    byJob: groupBy(
      used.filter((r) => r.partUsage),
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
    where: { type: { in: ["CHECKOUT", "CONSUME"] }, createdAt: { gte: from, lt: to } },
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
