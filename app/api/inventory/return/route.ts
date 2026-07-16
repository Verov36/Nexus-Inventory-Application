import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canCheckoutToTruck, canManageTrucksAndLimits } from "@/lib/roles";
import { adjustTruckStock, adjustWarehouseStock, getTruckStock } from "@/lib/inventory";

const returnSchema = z.object({
  partId: z.string().min(1),
  truckId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantity: z.number().int().positive(),
  notes: z.string().optional(),
});

// POST /api/inventory/return
// Moves stock the other direction from checkout: truck -> warehouse. Used
// when a tech brings back parts that weren't used, or a manager corrects a
// truck's count without writing the stock off entirely.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const userId = session.user.id;
  const role = (session.user as { role?: string }).role;

  const parsed = returnSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { partId, truckId, warehouseId, quantity, notes } = parsed.data;

  const truck = await prisma.truck.findUnique({ where: { id: truckId } });
  if (!truck) return NextResponse.json({ error: "Truck not found" }, { status: 404 });

  // A truck tech can only return stock off their own assigned truck — a
  // manager/admin can do this for any truck.
  const isOwnTruck = truck.techId === userId;
  if (!isOwnTruck && !canManageTrucksAndLimits(role)) {
    if (!canCheckoutToTruck(role)) {
      return NextResponse.json({ error: "Not authorized to move stock off this truck" }, { status: 403 });
    }
    return NextResponse.json({ error: "You can only return stock from your own truck" }, { status: 403 });
  }

  const truckStock = await getTruckStock(partId, truckId);
  if (!truckStock || truckStock.quantity < quantity) {
    return NextResponse.json(
      { error: `Only ${truckStock?.quantity ?? 0} of this part is on the truck — can't return more than that.` },
      { status: 409 }
    );
  }

  const part = await prisma.part.findUnique({ where: { id: partId } });
  if (!part) return NextResponse.json({ error: "Part not found" }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    await adjustTruckStock(tx, partId, truckId, -quantity);
    await adjustWarehouseStock(tx, partId, warehouseId, quantity);

    return tx.inventoryTransaction.create({
      data: {
        type: "RETURN",
        partId,
        quantity,
        fromLocationType: "TRUCK",
        fromTruckId: truckId,
        toLocationType: "WAREHOUSE",
        toWarehouseId: warehouseId,
        performedById: userId,
        notes: notes || null,
      },
    });
  });

  return NextResponse.json({ transaction: result }, { status: 201 });
}
