import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits } from "@/lib/roles";
import { InsufficientStockError, adjustTruckStock, getTruckStock } from "@/lib/inventory";

const adjustSchema = z.object({
  partId: z.string().min(1),
  truckId: z.string().min(1),
  quantity: z.number().int().positive(),
  reason: z.string().trim().min(1),
});

// POST /api/inventory/adjust
// Removes stock from a truck permanently — lost, damaged, or a count
// correction. Unlike a return, nothing comes back to the warehouse, so this
// is manager/admin only and always requires a stated reason for the audit
// trail.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!canManageTrucksAndLimits((session.user as { role?: string }).role)) {
    return NextResponse.json(
      { error: "Only a manager or admin can write off truck stock" },
      { status: 403 }
    );
  }
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { partId, truckId, quantity, reason } = parsed.data;

  const truck = await prisma.truck.findUnique({ where: { id: truckId }, select: { id: true } });
  if (!truck) return NextResponse.json({ error: "Truck not found" }, { status: 404 });

  const truckStock = await getTruckStock(partId, truckId);
  if (!truckStock || truckStock.quantity < quantity) {
    return NextResponse.json(
      { error: `Only ${truckStock?.quantity ?? 0} of this part is on the truck — can't remove more than that.` },
      { status: 409 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await adjustTruckStock(tx, partId, truckId, -quantity);
      return tx.inventoryTransaction.create({
        data: {
          type: "ADJUSTMENT",
          partId,
          quantity,
          fromLocationType: "TRUCK",
          fromTruckId: truckId,
          performedById: userId,
          notes: reason,
        },
      });
    });

    return NextResponse.json({ transaction: result }, { status: 201 });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: `Only ${err.available} of this part is on the truck — can't remove more than that.` },
        { status: 409 }
      );
    }
    console.error("Write-off failed:", err);
    return NextResponse.json({ error: "Something went wrong recording this write-off — try again." }, { status: 500 });
  }
}
