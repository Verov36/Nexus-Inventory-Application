import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canReceiveWarehouseStock } from "@/lib/roles";
import { adjustWarehouseStock, resolveWarehouseId } from "@/lib/inventory";

const receiveSchema = z.object({
  partId: z.string().min(1),
  warehouseId: z.string().optional().nullable(),
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = receiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { partId, quantity } = parsed.data;

  const part = await prisma.part.findUnique({ where: { id: partId } });
  if (!part) {
    return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }
  const warehouseId = await resolveWarehouseId(parsed.data.warehouseId);
  if (!warehouseId) {
    return NextResponse.json(
      { error: "No warehouse is configured yet — run the seed or set NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID." },
      { status: 404 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
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

      // The order this receipt fulfils is done — take it off the reorder
      // list's "on order" state.
      if (part.orderedAt) {
        await tx.part.update({
          where: { id: partId },
          data: { orderedAt: null, orderedQty: null, orderedById: null },
        });
      }

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
