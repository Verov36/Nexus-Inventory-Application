import { prisma } from "@/lib/prisma";
import type { InventoryTransaction } from "@prisma/client";
import {
  InsufficientStockError,
  adjustTruckStock,
  adjustWarehouseStock,
  findOrCreateJob,
  resolveWarehouseId,
} from "@/lib/inventory";
import { findApplicableLimit } from "@/lib/limits";
import { canCheckoutToTruck, canManageTrucksAndLimits } from "@/lib/roles";
import { describeOverCap, mergeLines, planCheckout, type CheckoutType, type PlanLine } from "@/lib/checkout-plan";

export type CheckoutRequest = {
  userId: string;
  role?: string | null;
  truckId: string;
  warehouseId?: string | null;
  checkoutType: CheckoutType;
  jobNumber?: string | null;
  items: { partId: string; quantity: number }[];
  justification?: { explanation: string; relatedJobNumbers: string[] } | null;
};

export type CheckoutOutcome =
  | { ok: true; status: 201; body: { transactions: InventoryTransaction[]; count: number } }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * One code path for both the single-part and cart checkouts: permission
 * checks, stock and cap planning, then a single transaction that moves
 * every line or nothing. Returns an HTTP-shaped outcome so the route
 * handlers stay thin.
 */
export async function performCheckout(req: CheckoutRequest): Promise<CheckoutOutcome> {
  const { userId, role, truckId, checkoutType, justification } = req;
  const jobNumber = req.jobNumber?.trim() || null;

  if (!canCheckoutToTruck(role)) {
    return fail(403, { error: "Only a truck tech (or admin) can check parts out to a truck." });
  }
  if (checkoutType === "JOB_USE" && !jobNumber) {
    return fail(400, { error: "A job / work order number is required for a job checkout." });
  }

  const items = mergeLines(req.items);
  if (items.length === 0) {
    return fail(400, { error: "Add at least one part with a quantity of 1 or more." });
  }

  const warehouseId = await resolveWarehouseId(req.warehouseId);
  if (!warehouseId) {
    return fail(404, {
      error: "No warehouse is configured yet — run the seed or set NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID.",
    });
  }

  const truck = await prisma.truck.findUnique({ where: { id: truckId } });
  if (!truck) return fail(404, { error: "Truck not found" });
  if (!truck.active) return fail(409, { error: `${truck.label} is deactivated — pick an active truck.` });
  // A tech can only load their own truck. Managers/admins can load any truck
  // (covering a tech's truck while they're out, or a spare).
  if (!canManageTrucksAndLimits(role) && truck.techId !== userId) {
    return fail(403, {
      error: "You can only check parts out to the truck assigned to you. Ask a manager to assign it.",
    });
  }

  const partIds = items.map((i) => i.partId);
  const [parts, warehouseLevels, truckLevels, limits] = await Promise.all([
    prisma.part.findMany({ where: { id: { in: partIds } } }),
    prisma.stockLevel.findMany({ where: { partId: { in: partIds }, warehouseId, truckId: null } }),
    prisma.stockLevel.findMany({ where: { partId: { in: partIds }, truckId, warehouseId: null } }),
    prisma.truckStockLimit.findMany({ where: { truckId } }),
  ]);

  const partById = new Map(parts.map((p) => [p.id, p]));
  const missing = partIds.filter((id) => !partById.has(id));
  if (missing.length > 0) {
    return fail(404, { error: "One or more parts no longer exist — remove them and try again.", missing });
  }
  const warehouseQty = new Map(warehouseLevels.map((sl) => [sl.partId, sl.quantity]));
  const truckQty = new Map(truckLevels.map((sl) => [sl.partId, sl.quantity]));

  const lines: PlanLine[] = items.map((item) => {
    const part = partById.get(item.partId)!;
    const limit = findApplicableLimit(limits, part);
    return {
      partId: part.id,
      sku: part.sku,
      name: part.name,
      quantity: item.quantity,
      warehouseQty: warehouseQty.get(part.id) ?? 0,
      truckQty: truckQty.get(part.id) ?? 0,
      limit: limit?.maxQty ?? null,
    };
  });

  const plan = planCheckout(lines, checkoutType);

  if (plan.insufficient.length > 0) {
    const first = plan.insufficient[0];
    return fail(409, {
      error:
        plan.insufficient.length === 1
          ? `Only ${first.available} of ${first.name} available in the warehouse`
          : `Not enough warehouse stock for ${plan.insufficient.length} parts: ${plan.insufficient
              .map((l) => `${l.name} (${l.available} available, ${l.requested} requested)`)
              .join(", ")}`,
      insufficient: plan.insufficient,
    });
  }

  if (plan.blockedByCap) {
    const first = plan.overCap[0];
    return fail(409, {
      error:
        plan.overCap.length === 1
          ? `That would put ${first.name} at ${first.projectedQty} on this truck, over the manager-set cap of ${first.limit}.`
          : `Restock would exceed the cap on ${plan.overCap.length} parts: ${plan.overCap
              .map((l) => `${l.name} (${l.projectedQty} vs cap ${l.limit})`)
              .join(", ")}. Lower those quantities.`,
      overCap: plan.overCap,
    });
  }

  if (plan.needsJustification && !justification) {
    const first = plan.overCap[0];
    return fail(409, {
      requiresJustification: true,
      // Single-line fields kept for the original checkout client.
      currentTruckQty: first.currentTruckQty,
      limit: first.limit,
      message: describeOverCap(plan.overCap),
      overCap: plan.overCap,
    });
  }

  const overCapIds = new Set(plan.overCap.map((l) => l.partId));

  try {
    const transactions = await prisma.$transaction(async (tx) => {
      const job = checkoutType === "JOB_USE" && jobNumber ? await findOrCreateJob(tx, jobNumber) : null;
      const created: InventoryTransaction[] = [];

      for (const line of lines) {
        await adjustWarehouseStock(tx, line.partId, warehouseId, -line.quantity);
        await adjustTruckStock(tx, line.partId, truckId, line.quantity);

        const transaction = await tx.inventoryTransaction.create({
          data: {
            type: "CHECKOUT",
            checkoutType,
            partId: line.partId,
            quantity: line.quantity,
            fromLocationType: "WAREHOUSE",
            fromWarehouseId: warehouseId,
            toLocationType: "TRUCK",
            toTruckId: truckId,
            performedById: userId,
          },
        });

        if (job) {
          await tx.partUsage.create({ data: { transactionId: transaction.id, jobId: job.id } });
        }

        if (justification && overCapIds.has(line.partId)) {
          await tx.overageJustification.create({
            data: {
              transactionId: transaction.id,
              truckId,
              submittedById: userId,
              explanation: justification.explanation,
              relatedJobNumbers: justification.relatedJobNumbers,
              status: "PENDING",
            },
          });
        }

        created.push(transaction);
      }

      return created;
    });

    return { ok: true, status: 201, body: { transactions, count: transactions.length } };
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return fail(409, {
        error: `Only ${err.available} of one of these parts is left in the warehouse — someone else may have just taken some. Nothing was moved; check the quantities and try again.`,
      });
    }
    console.error("Checkout failed:", err);
    return fail(500, { error: "Something went wrong recording this checkout. Nothing was moved — try again." });
  }
}

function fail(status: number, body: Record<string, unknown>): CheckoutOutcome {
  return { ok: false, status, body };
}
