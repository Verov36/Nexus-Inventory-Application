import { prisma } from "@/lib/prisma";
import { money, toNumber } from "@/lib/money";

// `to` is exclusive — callers pass the start of the day *after* the last day
// they want included, so a whole final day is never silently dropped.
//
// Two different things happen to parts on trucks and they're reported apart:
//   loaded — CHECKOUT, warehouse to truck (stock moves, nothing is spent)
//   used   — CONSUME, truck to a customer's job (this is the parts cost),
//            net of CONSUME_REVERSAL (parts put back), at the cost frozen
//            when each part was used
// Job costs come only from "used". Stored snapshots from before CONSUME
// existed have only the load fields; the page treats the used ones as optional.
export async function generateUsageSummary(from: Date, to: Date) {
  const all = await getTransactionRows(from, to);
  const rows = all.filter((r) => r.type === "CHECKOUT");
  const used = all.filter((r) => r.type === "CONSUME" || r.type === "CONSUME_REVERSAL");

  const jobUse = rows.filter((r) => r.checkoutType === "JOB_USE");
  const restock = rows.filter((r) => r.checkoutType === "RESTOCK");
  type Row = (typeof all)[number];
  // Reversals count against what was used.
  const qty = (r: Row) => (r.type === "CONSUME_REVERSAL" ? -r.quantity : r.quantity);
  // Frozen at time of use when recorded; loads use the part's current cost.
  const unitCostOf = (r: Row) => (r.unitCost ?? r.part.unitCost);
  const jobOf = (r: Row) => r.partUsage?.job ?? r.reverses?.partUsage?.job ?? null;
  const personOf = (r: Row) => r.performedByName ?? r.performedBy.name;
  const lineCost = (r: Row) => money(qty(r) * toNumber(unitCostOf(r)));
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
    usedUnits: used.reduce((sum, i) => sum + qty(i), 0),
    usedCost: sumCost(used),
    byTech: groupBy(all, personOf).map(([tech, items]) => {
      const loads = items.filter((i) => i.type === "CHECKOUT");
      const uses = items.filter((i) => i.type === "CONSUME" || i.type === "CONSUME_REVERSAL");
      return {
        tech,
        partsCheckedOut: loads.reduce((sum, i) => sum + i.quantity, 0),
        jobUseCount: loads.filter((i) => i.checkoutType === "JOB_USE").length,
        restockCount: loads.filter((i) => i.checkoutType === "RESTOCK").length,
        cost: sumCost(loads),
        partsUsed: uses.reduce((sum, i) => sum + qty(i), 0),
        usedCost: sumCost(uses),
      };
    }),
    byPart: groupBy(all, (r) => r.part.id)
      .map(([, items]) => {
        const loads = items.filter((i) => i.type === "CHECKOUT");
        const uses = items.filter((i) => i.type === "CONSUME" || i.type === "CONSUME_REVERSAL");
        return {
          sku: items[0].part.sku,
          part: items[0].part.name,
          quantity: loads.reduce((sum, i) => sum + i.quantity, 0),
          unitCost: items[0].part.unitCost === null ? null : toNumber(items[0].part.unitCost),
          cost: sumCost(loads),
          usedQuantity: uses.reduce((sum, i) => sum + qty(i), 0),
          usedCost: sumCost(uses),
        };
      })
      .sort((a, b) => b.usedCost - a.usedCost || b.cost - a.cost || b.quantity - a.quantity),
    // What each job actually consumed.
    byJob: groupBy(
      used.filter((r) => jobOf(r)),
      (r) => jobOf(r)!.jobNumber
    ).map(([jobNumber, items]) => ({
      jobNumber,
      customer: jobOf(items[0])!.customer,
      cost: sumCost(items),
      parts: items.map((i) => ({
        sku: i.part.sku,
        part: i.part.name,
        quantity: qty(i),
        unitCost: unitCostOf(i) === null ? null : toNumber(unitCostOf(i)),
        cost: lineCost(i),
      })),
    })),
  };
}

export type UsageSummary = Awaited<ReturnType<typeof generateUsageSummary>>;

export async function getTransactionRows(from: Date, to: Date) {
  return prisma.inventoryTransaction.findMany({
    where: { type: { in: ["CHECKOUT", "CONSUME", "CONSUME_REVERSAL"] }, createdAt: { gte: from, lt: to } },
    include: {
      part: true,
      performedBy: { select: { name: true } },
      partUsage: { include: { job: true } },
      reverses: { select: { partUsage: { include: { job: true } } } },
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
