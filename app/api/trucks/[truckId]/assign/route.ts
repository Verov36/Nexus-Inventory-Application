import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const assignSchema = z.object({ techId: z.string().nullable() });

export async function POST(req: NextRequest, { params }: { params: { truckId: string } }) {
  const parsed = assignSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.techId) {
    const alreadyAssigned = await prisma.truck.findUnique({ where: { techId: parsed.data.techId } });
    if (alreadyAssigned && alreadyAssigned.id !== params.truckId) {
      return NextResponse.json(
        { error: `That tech is already assigned to ${alreadyAssigned.label}` },
        { status: 409 }
      );
    }
  }

  const truck = await prisma.truck.update({
    where: { id: params.truckId },
    data: { techId: parsed.data.techId },
    include: { tech: { select: { id: true, name: true, email: true } } },
  });
  return NextResponse.json({ truck });
}
