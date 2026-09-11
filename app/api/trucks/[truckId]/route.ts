import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits } from "@/lib/roles";
import { z } from "zod";

const updateSchema = z.object({
  label: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { truckId: string } }) {
  const session = await auth();
  if (!canManageTrucksAndLimits((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const existing = await prisma.truck.findUnique({ where: { id: params.truckId } });
  if (!existing) return NextResponse.json({ error: "Truck not found" }, { status: 404 });

  // Deactivating a truck also frees its tech, so the tech can be assigned
  // elsewhere and doesn't keep loading a truck that's off the road.
  const data = parsed.data.active === false ? { ...parsed.data, techId: null } : parsed.data;
  const truck = await prisma.truck.update({ where: { id: params.truckId }, data });
  return NextResponse.json({ truck });
}

export async function DELETE(_req: NextRequest, { params }: { params: { truckId: string } }) {
  const session = await auth();
  if (!canManageTrucksAndLimits((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const truck = await prisma.truck.findUnique({
    where: { id: params.truckId },
    include: { stockLevels: true, _count: { select: { justifications: true } } },
  });
  if (!truck) return NextResponse.json({ error: "Truck not found" }, { status: 404 });

  const totalStock = truck.stockLevels.reduce((sum, sl) => sum + sl.quantity, 0);
  if (totalStock > 0) {
    return NextResponse.json(
      {
        error: `This truck still has ${totalStock} units of stock assigned to it. Move or account for that stock before deleting — deactivating it instead will hide it from lists without losing the record.`,
      },
      { status: 409 }
    );
  }

  const hasHistory =
    truck._count.justifications > 0 ||
    (await prisma.inventoryTransaction.count({
      where: { OR: [{ fromTruckId: truck.id }, { toTruckId: truck.id }] },
    })) > 0;

  if (hasHistory) {
    // Checkout/return history references this truck for the audit trail, so
    // a hard delete would leave orphaned records. Deactivate instead.
    await prisma.truck.update({ where: { id: params.truckId }, data: { active: false, techId: null } });
    return NextResponse.json({
      deleted: false,
      deactivated: true,
      message:
        "This truck has inventory history tied to it, so it can't be permanently deleted without losing that audit trail. It's been deactivated instead — hidden from active lists, unassigned from its tech, but its records are preserved.",
    });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.truckStockLimit.deleteMany({ where: { truckId: params.truckId } });
      await tx.stockLevel.deleteMany({ where: { truckId: params.truckId } });
      await tx.truck.delete({ where: { id: params.truckId } });
    });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("Truck delete failed:", err);
    await prisma.truck.update({ where: { id: params.truckId }, data: { active: false, techId: null } });
    return NextResponse.json({
      deleted: false,
      deactivated: true,
      message: "This truck couldn't be permanently deleted, so it's been deactivated instead.",
    });
  }
}
