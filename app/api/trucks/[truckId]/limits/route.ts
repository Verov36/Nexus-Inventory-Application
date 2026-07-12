import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";

const limitSchema = z
  .object({
    partId: z.string().optional(),
    category: z.string().optional(),
    maxQty: z.number().int().min(0),
  })
  .refine((d) => !!d.partId !== !!d.category, {
    message: "Set exactly one of partId or category, not both",
  });

export async function GET(_req: NextRequest, { params }: { params: { truckId: string } }) {
  const limits = await prisma.truckStockLimit.findMany({
    where: { truckId: params.truckId },
    include: { part: true },
  });
  return NextResponse.json({ limits });
}

export async function POST(req: NextRequest, { params }: { params: { truckId: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if ((session.user as { role?: string }).role !== "MANAGER") {
    return NextResponse.json({ error: "Only managers can set truck stock limits" }, { status: 403 });
  }

  const parsed = limitSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { partId, category, maxQty } = parsed.data;

  const limit = await prisma.truckStockLimit.upsert({
    where: {
      truckId_partId_category: {
        truckId: params.truckId,
        partId: partId ?? (null as unknown as string),
        category: category ?? (null as unknown as string),
      },
    },
    create: {
      truckId: params.truckId,
      partId,
      category,
      maxQty,
      setById: session.user.id,
    },
    update: { maxQty, setById: session.user.id },
  });

  return NextResponse.json({ limit }, { status: 201 });
}
