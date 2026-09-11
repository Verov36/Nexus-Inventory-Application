import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits } from "@/lib/roles";

const limitSchema = z
  .object({
    partId: z.string().trim().min(1).optional(),
    category: z.string().trim().min(1).optional(),
    maxQty: z.number().int().min(0),
  })
  .refine((d) => !!d.partId !== !!d.category, {
    message: "Set exactly one of partId or category, not both",
  });

export async function GET(_req: NextRequest, { params }: { params: { truckId: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = limitSchema.safeParse(body);
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
      : await prisma.truckStockLimit.findFirst({
          where: { truckId: params.truckId, category: { equals: category, mode: "insensitive" }, partId: null },
        });

    const limit = existing
      ? await prisma.truckStockLimit.update({
          where: { id: existing.id },
          data: { maxQty, setById: session.user.id },
          include: { part: true },
        })
      : await prisma.truckStockLimit.create({
          data: { truckId: params.truckId, partId, category, maxQty, setById: session.user.id },
          include: { part: true },
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

const deleteSchema = z.object({ limitId: z.string().min(1) });

// DELETE /api/trucks/:truckId/limits  { limitId } — remove a cap entirely.
// Previously the only way to "remove" a cap was to set it to 0, which
// actually blocks every restock of that part rather than lifting the limit.
export async function DELETE(req: NextRequest, { params }: { params: { truckId: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!canManageTrucksAndLimits((session.user as { role?: string }).role)) {
    return NextResponse.json({ error: "Only a manager or admin can remove truck stock limits" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const result = await prisma.truckStockLimit.deleteMany({
    where: { id: parsed.data.limitId, truckId: params.truckId },
  });
  if (result.count === 0) return NextResponse.json({ error: "Cap not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
