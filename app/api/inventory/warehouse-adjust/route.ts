import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canEditParts } from "@/lib/roles";
import { getWarehouseStock, adjustWarehouseStock } from "@/lib/inventory";

const adjustSchema = z.object({
  partId: z.string().min(1),
  warehouseId: z.string().min(1),
  actualQuantity: z.number().int().min(0),
  reason: z.string().min(1),
});

// POST /api/inventory/warehouse-adjust
// Takes what was physically counted, not a +/- amount — the server works
// out the difference itself so nobody has to do math to figure out "how
// much do I add or remove" mid-count. Always requires a reason, and always
// leaves a signed ADJUSTMENT transaction behind either way.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!canEditParts((session?.user as { role?: string })?.role)) {
    return NextResponse.json(
      { error: "Only a warehouse manager or manager can adjust warehouse counts" },
      { status: 403 }
    );
  }
  const userId = session!.user!.id!;

  const parsed = adjustSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { partId, warehouseId, actualQuantity, reason } = parsed.data;

  const part = await prisma.part.findUnique({ where: { id: partId } });
  if (!part) return NextResponse.json({ error: "Part not found" }, { status: 404 });

  const current = await getWarehouseStock(partId, warehouseId);
  const currentQuantity = current?.quantity ?? 0;
  const delta = actualQuantity - currentQuantity;

  if (delta === 0) {
    return NextResponse.json(
      { unchanged: true, message: "That matches the current count — nothing to adjust." },
      { status: 200 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await adjustWarehouseStock(tx, partId, warehouseId, delta);
    return tx.inventoryTransaction.create({
      data: {
        type: "ADJUSTMENT",
        partId,
        quantity: Math.abs(delta),
        fromLocationType: delta < 0 ? "WAREHOUSE" : undefined,
        fromWarehouseId: delta < 0 ? warehouseId : undefined,
        toLocationType: delta > 0 ? "WAREHOUSE" : undefined,
        toWarehouseId: delta > 0 ? warehouseId : undefined,
        performedById: userId,
        notes: reason,
      },
    });
  });

  return NextResponse.json(
    { transaction: result, previousQuantity: currentQuantity, newQuantity: actualQuantity, delta },
    { status: 201 }
  );
}
