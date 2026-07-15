import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits } from "@/lib/roles";
import { z } from "zod";

const updateSchema = z.object({
  label: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { truckId: string } }) {
  const session = await auth();
  if (!canManageTrucksAndLimits((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const truck = await prisma.truck.update({ where: { id: params.truckId }, data: parsed.data });
  return NextResponse.json({ truck });
}

export async function DELETE(_req: NextRequest, { params }: { params: { truckId: string } }) {
  const session = await auth();
  if (!canManageTrucksAndLimits((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const truck = await prisma.truck.findUnique({
    where: { id: params.truckId },
    include: { stockLevels: true },
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

  try {
    await prisma.$transaction(async (tx) => {
      await tx.truckStockLimit.deleteMany({ where: { truckId: params.truckId } });
      await tx.stockLevel.deleteMany({ where: { truckId: params.truckId } });
      await tx.truck.delete({ where: { id: params.truckId } });
    });
    return NextResponse.json({ deleted: true });
  } catch {
    // Most likely cause: this truck has overage justification history tied to
    // it, which we don't want to silently destroy for audit purposes. Fall
    // back to deactivating instead of a hard delete.
    await prisma.truck.update({ where: { id: params.truckId }, data: { active: false, techId: null } });
    return NextResponse.json({
      deleted: false,
      deactivated: true,
      message:
        "This truck has justification history tied to it, so it can't be permanently deleted without losing that audit trail. It's been deactivated instead — hidden from active lists, unassigned from its tech, but its records are preserved.",
    });
  }
}
