import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";

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

  const body = await req.json();
  const parsed = receiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { partId, warehouseId, quantity } = parsed.data;

  // NOTE: Postgres treats NULL as distinct in unique indexes, so the
  // @@unique([partId, warehouseId, truckId]) constraint doesn't fully protect
  // against duplicate warehouse rows (truckId always null here) under
  // concurrent requests. Before production, add a partial unique index:
  //   CREATE UNIQUE INDEX stock_level_warehouse_unique
  //   ON "StockLevel" ("partId", "warehouseId") WHERE "truckId" IS NULL;
  // and the truck equivalent for ("partId", "truckId") WHERE "warehouseId" IS NULL.
  const result = await prisma.$transaction(async (tx) => {

    const stockLevel = await tx.stockLevel.upsert({
      where: {
        partId_warehouseId_truckId: {
          partId,
          warehouseId,
          truckId: null as unknown as string, // composite unique requires explicit null match
        },
      },
      create: {
        partId,
        warehouseId,
        locationType: "WAREHOUSE",
        quantity,
      },
      update: {
        quantity: { increment: quantity },
      },
    });

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
}
