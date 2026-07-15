import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits } from "@/lib/roles";

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
  if (!canManageTrucksAndLimits((session.user as { role?: string }).role)) {
    return NextResponse.json({ error: "Only a manager or admin can set truck stock limits" }, { status: 403 });
  }

  const parsed = limitSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { partId, category, maxQty } = parsed.data;

  if (partId) {
    const part = await prisma.part.findUnique({ where: { id: partId } });
    if (!part) return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }
  const truck = await prisma.truck.findUnique({ where: { id: params.truckId } });
  if (!truck) return NextResponse.json({ error: "Truck not found" }, { status: 404 });

  try {
    // find-then-create-or-update — same fix as the receive endpoint. A plain
    // upsert here relies on Postgres detecting a conflict on (truckId,
    // partId, category), but a normal unique constraint never treats two
    // NULLs (the unset partId or category column) as equal, so re-setting an
    // existing cap threw a raw duplicate-key error instead of updating it.
    const existing = partId
      ? await prisma.truckStockLimit.findFirst({ where: { truckId: params.truckId, partId } })
      : await prisma.truckStockLimit.findFirst({ where: { truckId: params.truckId, category, partId: null } });

    const limit = existing
      ? await prisma.truckStockLimit.update({
          where: { id: existing.id },
          data: { maxQty, setById: session.user.id },
        })
      : await prisma.truckStockLimit.create({
          data: { truckId: params.truckId, partId, category, maxQty, setById: session.user.id },
        });

    return NextResponse.json({ limit }, { status: 201 });
  } catch (err) {
    console.error("Setting truck stock limit failed:", err);
    return NextResponse.json(
      { error: "Something went wrong setting this cap — try again." },
      { status: 500 }
    );
  }
}
