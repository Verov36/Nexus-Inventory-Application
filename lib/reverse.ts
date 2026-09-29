import { prisma } from "@/lib/prisma";
import { adjustTruckStock } from "@/lib/inventory";
import { oncePerKey } from "@/lib/idempotency";

export type ReverseInput = {
  /** The CONSUME ledger row being (partly) undone. */
  lineId: string;
  /** Only lines on this job may be reversed through this call. */
  externalJobId: string;
  quantity: number;
  reason: string;
  performedById: string;
  performedByExternal?: { id: string; name?: string };
  idempotencyKey?: string;
  callerScope: string;
};

type Outcome = { ok: boolean; status: number; body: Record<string, unknown> };

class Refused extends Error {
  constructor(public readonly status: number, public readonly body: Record<string, unknown>) {
    super(String(body.code));
  }
}

/**
 * Puts parts recorded as used on a job back onto the truck they came from.
 * Never deletes: it posts a CONSUME_REVERSAL that points at the original
 * line, carrying the same frozen cost and price, so the job's totals and the
 * audit trail both stay right.
 *
 * The original line is locked while this runs, so two reversals at once can't
 * together put back more than was used.
 */
export async function reverseConsumption(input: ReverseInput): Promise<Outcome> {
  try {
    const result = await prisma.$transaction(
      (tx) =>
        oncePerKey(tx, `reverse:${input.callerScope}`, input.idempotencyKey, async () => {
          const [locked] = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "InventoryTransaction" WHERE "id" = ${input.lineId} FOR UPDATE`;
          // Scoped read: another organization's line is simply not found.
          const line = locked
            ? await tx.inventoryTransaction.findUnique({
                where: { id: input.lineId },
                include: { partUsage: { include: { job: true } }, part: { select: { name: true } } },
              })
            : null;
          if (!line || line.type !== "CONSUME" || line.partUsage?.job.externalId !== input.externalJobId) {
            throw new Refused(404, { error: "No such parts-used line on this job.", code: "not_found" });
          }
          const reversed = await tx.inventoryTransaction.aggregate({
            _sum: { quantity: true },
            where: { reversesId: line.id, type: "CONSUME_REVERSAL" },
          });
          const remaining = line.quantity - (reversed._sum.quantity ?? 0);
          if (input.quantity > remaining) {
            throw new Refused(409, {
              error: `Only ${remaining} of this line can still be reversed.`,
              code: "exceeds_used_quantity",
              remaining,
            });
          }
          if (!line.fromTruckId) throw new Refused(409, { error: "This line didn't come off a truck.", code: "not_reversible" });

          await adjustTruckStock(tx, line.partId, line.fromTruckId, input.quantity);
          const reversal = await tx.inventoryTransaction.create({
            data: {
              type: "CONSUME_REVERSAL",
              partId: line.partId,
              quantity: input.quantity,
              toLocationType: "TRUCK",
              toTruckId: line.fromTruckId,
              reversesId: line.id,
              unitCost: line.unitCost,
              unitPrice: line.unitPrice,
              performedById: input.performedById,
              performedByExternalId: input.performedByExternal?.id ?? null,
              performedByName: input.performedByExternal?.name ?? null,
              notes: input.reason,
            },
          });
          return {
            status: 201,
            body: {
              reversalId: reversal.id,
              lineId: line.id,
              quantity: input.quantity,
              remainingOnLine: remaining - input.quantity,
            },
          };
        }),
      { timeout: 30_000 }
    );
    return { ok: true, status: result.status, body: { ...result.body, replayed: result.replayed } };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, status: err.status, body: err.body };
    console.error("Reversing parts used failed:", err);
    return { ok: false, status: 500, body: { error: "Something went wrong. Nothing was changed.", code: "internal_error" } };
  }
}

/**
 * Every parts-used line on a job, net of reversals, with the frozen cost and
 * price. This is what quotes, completion sheets and invoices read.
 */
export async function partsUsedOnJob(externalJobId: string) {
  const job = await prisma.job.findFirst({ where: { externalId: externalJobId } });
  if (!job) return null;
  const lines = await prisma.inventoryTransaction.findMany({
    where: { type: "CONSUME", partUsage: { jobId: job.id } },
    include: {
      part: { select: { id: true, sku: true, name: true } },
      reversals: { select: { quantity: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const round = (n: number) => Math.round(n * 100) / 100;
  const out = lines.map((l) => {
    const reversedQty = l.reversals.reduce((n, r) => n + r.quantity, 0);
    const quantity = l.quantity - reversedQty;
    const unitCost = l.unitCost === null ? null : Number(l.unitCost);
    const unitPrice = l.unitPrice === null ? null : Number(l.unitPrice);
    return {
      lineId: l.id,
      part: l.part,
      truckId: l.fromTruckId,
      quantityUsed: l.quantity,
      quantityReversed: reversedQty,
      quantity,
      unitCost,
      unitPrice,
      lineCost: unitCost === null ? null : round(unitCost * quantity),
      linePrice: unitPrice === null ? null : round(unitPrice * quantity),
      usedBy: l.performedByExternalId ? { externalUserId: l.performedByExternalId, name: l.performedByName } : null,
      usedAt: l.createdAt,
      notes: l.notes,
    };
  });
  const sum = (key: "lineCost" | "linePrice") =>
    round(out.reduce((n, l) => n + (l[key] ?? 0), 0));
  return {
    job: { externalId: job.externalId, jobNumber: job.jobNumber },
    lines: out,
    totals: {
      cost: sum("lineCost"),
      price: sum("linePrice"),
      unpricedLines: out.filter((l) => l.unitPrice === null && l.quantity > 0).length,
    },
  };
}
