import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canReceiveWarehouseStock } from "@/lib/roles";
import { adjustWarehouseStock } from "@/lib/inventory";

const receiveSchema = z.object({
  partId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantity: z.number().int().positive(),
});

// POST /api/inventory/receive
// Records a RECEIVE transaction and increments the warehouse StockLevel for
// this part. This is the "checked in and accounted for" step before any part
// is eligible to be assigned out to a truck.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const userId = session.user.id;

  // Checked fresh against the database (not the JWT session) so a
  // permission change an admin makes in /admin/users takes effect
  // immediately rather than waiting for the affected user's session to
  // refresh on next login.
  const actingUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, canReceiveParts: true },
  });
  if (!actingUser || !canReceiveWarehouseStock(actingUser.role, actingUser.canReceiveParts)) {
    return NextResponse.json(
      { error: "You're not currently designated to receive warehouse parts. Ask a manager to enable it for your account." },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = receiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { partId, warehouseId, quantity } = parsed.data;

  const part = await prisma.part.findUnique({ where: { id: partId } });
  if (!part) {
    return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) {
    return NextResponse.json({ error: "Warehouse not found — check NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID" }, { status: 404 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // find-then-create-or-update, same safe pattern used by checkout and
      // the mass import — avoids relying on Postgres to detect a "conflict"
      // on a NULL truckId, which a plain unique constraint never does.
      const stockLevel = await adjustWarehouseStock(tx, partId, warehouseId, quantity);

      const transaction = await tx.inventoryTransaction.create({
        data: {
          type: "RECEIVE",
          partId,
          quantity,
          toLocationType: "WAREHOUSE",
          toWarehouseId: warehouseId,
          performedById: userId,
        },
      });

      return { stockLevel, transaction };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("Receive failed:", err);
    return NextResponse.json(
      { error: "Something went wrong recording this receipt. Nothing was added to inventory — try again." },
      { status: 500 }
    );
  }
}
