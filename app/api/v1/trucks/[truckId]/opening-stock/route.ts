import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, withApiKey } from "@/lib/api";
import { adjustTruckStock, lockStockQty } from "@/lib/inventory";
import { idempotencyKeyFrom, oncePerKey } from "@/lib/idempotency";
import { serviceAccountId } from "@/lib/service-account";

const schema = z.object({
  items: z
    .array(z.object({ partId: z.string().min(1), quantity: z.number().int().min(0).max(1_000_000) }))
    .min(1)
    .max(1000),
});

// POST /api/v1/trucks/{truckId}/opening-stock  (Idempotency-Key required)
// Sets what's on a truck when moving its inventory over from the Field App.
// Each part is set to the given quantity (not added to), and every change is
// an ADJUSTMENT marked as an opening balance, so the ledger explains it.
async function handlePOST(req: NextRequest, ctx: { params: Promise<{ truckId: string }> }, key: { organizationId: string }) {
  const { truckId } = await ctx.params;
  const idempotencyKey = idempotencyKeyFrom(req.headers);
  if (!idempotencyKey) return apiError(400, "idempotency_key_required", "Send an Idempotency-Key header.");
  const read = await readJson(req, schema);
  if ("response" in read) return read.response;

  const truck = await prisma.truck.findUnique({ where: { id: truckId }, select: { id: true } });
  if (!truck) return apiError(404, "not_found", "Truck not found.");
  const partIds = [...new Set(read.data.items.map((i) => i.partId))];
  const found = await prisma.part.count({ where: { id: { in: partIds } } });
  if (found !== partIds.length) return apiError(404, "part_not_found", "One or more parts don't exist.");

  const performedById = await serviceAccountId();
  const target = new Map(read.data.items.map((i) => [i.partId, i.quantity]));
  const result = await prisma.$transaction(
    (tx) =>
      oncePerKey(tx, `opening:api:${key.organizationId}`, idempotencyKey, async () => {
        const lines = [];
        for (const partId of [...target.keys()].sort()) {
          const quantity = target.get(partId)!;
          const current = await lockStockQty(tx, partId, { truckId });
          const delta = quantity - current;
          if (delta !== 0) {
            await adjustTruckStock(tx, partId, truckId, delta);
            await tx.inventoryTransaction.create({
              data: {
                type: "ADJUSTMENT",
                partId,
                quantity: Math.abs(delta),
                ...(delta > 0
                  ? { toLocationType: "TRUCK", toTruckId: truckId }
                  : { fromLocationType: "TRUCK", fromTruckId: truckId }),
                performedById,
                notes: "Opening balance imported from the Field App",
              },
            });
          }
          lines.push({ partId, quantity, previous: current });
        }
        return { status: 200, body: { truckId, lines } };
      }),
    { timeout: 60_000 }
  );
  return NextResponse.json({ ...result.body, replayed: result.replayed }, { status: result.status });
}

export const POST = withApiKey(handlePOST);
