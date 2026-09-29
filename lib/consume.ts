import { prisma } from "@/lib/prisma";
import { InsufficientStockError, adjustTruckStock, findOrCreateJob } from "@/lib/inventory";
import { oncePerKey } from "@/lib/idempotency";
import { defaultMarkupPct, priceFor } from "@/lib/pricing";

export type ConsumeItem = { partId: string; quantity: number };

export type ConsumeInput = {
  truckId: string;
  jobNumber: string;
  items: ConsumeItem[];
  notes?: string;
  performedById: string;
  /** Replay protection: the same key from the same caller never moves stock twice. */
  idempotencyKey?: string;
  /** Who's calling, for scoping idempotency keys (a user id or an API client id). */
  callerScope: string;
  /** The Field App's job id, when the job came from there. */
  externalJobId?: string;
  /** The real person, when the call came through the API. */
  performedByExternal?: { id: string; name?: string };
};

export class JobConflict extends Error {}

export type ConsumeOutcome = { ok: boolean; status: number; body: Record<string, unknown> };

/**
 * Records parts as used on a job: they come off the truck and out of
 * inventory, and are costed to that job. This is the only way parts leave
 * inventory for a customer — loading a truck "for a job" just moves stock.
 *
 * All-or-nothing: if any line would take the truck below zero, nothing is
 * recorded. Lines are applied in part-id order so concurrent requests lock
 * rows in the same order (no deadlocks).
 */
export async function consumeFromTruck(input: ConsumeInput): Promise<ConsumeOutcome> {
  // Same part listed twice (two scans) becomes one line.
  const merged = new Map<string, number>();
  for (const i of input.items) merged.set(i.partId, (merged.get(i.partId) ?? 0) + i.quantity);
  const items = [...merged.entries()]
    .map(([partId, quantity]) => ({ partId, quantity }))
    .sort((a, b) => (a.partId < b.partId ? -1 : 1));

  const truck = await prisma.truck.findUnique({
    where: { id: input.truckId },
    select: { id: true, label: true, active: true },
  });
  if (!truck) return fail(404, { error: "Truck not found" });
  if (!truck.active) {
    return fail(409, { error: `${truck.label} is deactivated — reactivate it to record parts used from it.` });
  }

  const parts = await prisma.part.findMany({
    where: { id: { in: items.map((i) => i.partId) } },
    select: { id: true, name: true, sku: true, unitCost: true, listPrice: true },
  });
  const markupPct = await defaultMarkupPct();
  const partById = new Map(parts.map((p) => [p.id, p]));
  const missing = items.filter((i) => !partById.has(i.partId)).map((i) => i.partId);
  if (missing.length) return fail(404, { error: "One or more parts don't exist.", missing });

  try {
    const result = await prisma.$transaction(
      (tx) =>
        oncePerKey(tx, `consume:${input.callerScope}`, input.idempotencyKey, async () => {
          const job = await findOrCreateJob(tx, input.jobNumber, input.externalJobId);
          if (input.externalJobId && job.externalId !== input.externalJobId) throw new JobConflict();
          const consumed = [];
          for (const item of items) {
            const part = partById.get(item.partId)!;
            let level;
            try {
              level = await adjustTruckStock(tx, item.partId, truck.id, -item.quantity);
            } catch (err) {
              if (err instanceof InsufficientStockError) throw new ShortOnTruck(part.name, err.available, item.quantity);
              throw err;
            }
            // Frozen now: a later cost or price change never rewrites what
            // this job cost or was billed.
            const price = priceFor(part, markupPct);
            const transaction = await tx.inventoryTransaction.create({
              data: {
                type: "CONSUME",
                partId: item.partId,
                quantity: item.quantity,
                fromLocationType: "TRUCK",
                fromTruckId: truck.id,
                performedById: input.performedById,
                performedByExternalId: input.performedByExternal?.id ?? null,
                performedByName: input.performedByExternal?.name ?? null,
                unitCost: part.unitCost,
                unitPrice: price.unitPrice,
                notes: input.notes || null,
              },
            });
            await tx.partUsage.create({
              data: { transactionId: transaction.id, jobId: job.id, notes: input.notes || null },
            });
            consumed.push({
              partId: part.id,
              sku: part.sku,
              name: part.name,
              quantity: item.quantity,
              remainingOnTruck: level.quantity,
              transactionId: transaction.id,
              unitCost: part.unitCost === null ? null : Number(part.unitCost),
              unitPrice: price.unitPrice,
            });
          }
          return { status: 201, body: { jobNumber: job.jobNumber, truckId: truck.id, consumed } };
        }),
      { timeout: 30_000 }
    );
    return { ok: true, status: result.status, body: { ...result.body, replayed: result.replayed } };
  } catch (err) {
    if (err instanceof JobConflict) {
      return fail(409, {
        error: `Job number ${input.jobNumber} already belongs to a different job.`,
        code: "job_number_conflict",
      });
    }
    if (err instanceof ShortOnTruck) {
      return fail(409, {
        error: `Only ${err.available} ${err.partName} on ${truck.label}, but ${err.requested} were entered. Nothing was recorded — fix that line and try again.`,
        code: "insufficient_stock",
        partName: err.partName,
        available: err.available,
        requested: err.requested,
      });
    }
    console.error("Recording parts used failed:", err);
    return fail(500, { error: "Something went wrong recording these parts. Nothing was changed — try again." });
  }
}

class ShortOnTruck extends Error {
  constructor(
    public readonly partName: string,
    public readonly available: number,
    public readonly requested: number
  ) {
    super("short on truck");
  }
}

function fail(status: number, body: Record<string, unknown>): ConsumeOutcome {
  return { ok: false, status, body };
}
