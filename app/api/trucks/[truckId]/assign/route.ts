import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits } from "@/lib/roles";

const assignSchema = z.object({ techId: z.string().nullable() });

export async function POST(req: NextRequest, { params }: { params: { truckId: string } }) {
  const session = await auth();
  if (!canManageTrucksAndLimits((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Only a manager or admin can assign techs to trucks" }, { status: 403 });
  }

  const parsed = assignSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const truck = await prisma.$transaction(async (tx) => {
    // If this tech is already driving another truck, free that truck up
    // first — reassigning someone is a normal "switch techs around" move,
    // not something that should be blocked.
    if (parsed.data.techId) {
      const alreadyAssigned = await tx.truck.findUnique({ where: { techId: parsed.data.techId } });
      if (alreadyAssigned && alreadyAssigned.id !== params.truckId) {
        await tx.truck.update({ where: { id: alreadyAssigned.id }, data: { techId: null } });
      }
    }

    return tx.truck.update({
      where: { id: params.truckId },
      data: { techId: parsed.data.techId },
      include: { tech: { select: { id: true, name: true, email: true } } },
    });
  });

  return NextResponse.json({ truck });
}
