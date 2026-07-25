import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits, canViewFleet } from "@/lib/roles";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (!canViewFleet(role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // A truck tech only ever sees their own assigned truck — everyone else
  // (managers, admins, warehouse roles) sees the full fleet.
  const where = role === "TRUCK_TECH" ? { techId: session.user.id } : undefined;

  const trucks = await prisma.truck.findMany({
    where,
    include: {
      tech: { select: { id: true, name: true, email: true } },
      stockLevels: { include: { part: true } },
      stockLimits: { include: { part: true } },
    },
    orderBy: { label: "asc" },
  });

  // Reconstruct how much of each truck's current stock is job-designated
  // vs. general restock. Checkouts add to one bucket or the other; returns
  // and write-offs remove stock but were never subtracted from either
  // bucket before, so the breakdown could show stock that had already left
  // the truck. Removals come off the restock bucket first (general reserve
  // is the more natural thing to hand back or write off), then spill into
  // the job bucket if there's more removed than was ever restocked — that
  // guarantees job + restock always equals the truck's real current total.
  const truckIds = trucks.map((t) => t.id);
  const [checkoutRows, removalRows] = await Promise.all([
    prisma.inventoryTransaction.groupBy({
      by: ["toTruckId", "partId", "checkoutType"],
      where: { type: "CHECKOUT", toTruckId: { in: truckIds } },
      _sum: { quantity: true },
    }),
    prisma.inventoryTransaction.groupBy({
      by: ["fromTruckId", "partId"],
      where: { type: { in: ["RETURN", "ADJUSTMENT"] }, fromTruckId: { in: truckIds } },
      _sum: { quantity: true },
    }),
  ]);

  const breakdownMap = new Map<string, { job: number; restock: number }>();
  for (const row of checkoutRows) {
    const key = `${row.toTruckId}|${row.partId}`;
    const entry = breakdownMap.get(key) ?? { job: 0, restock: 0 };
    if (row.checkoutType === "JOB_USE") entry.job += row._sum.quantity ?? 0;
    if (row.checkoutType === "RESTOCK") entry.restock += row._sum.quantity ?? 0;
    breakdownMap.set(key, entry);
  }
  for (const row of removalRows) {
    const key = `${row.fromTruckId}|${row.partId}`;
    const entry = breakdownMap.get(key) ?? { job: 0, restock: 0 };
    let removed = row._sum.quantity ?? 0;
    const fromRestock = Math.min(entry.restock, removed);
    entry.restock -= fromRestock;
    removed -= fromRestock;
    entry.job = Math.max(0, entry.job - removed);
    breakdownMap.set(key, entry);
  }

  const trucksWithBreakdown = trucks.map((truck) => ({
    ...truck,
    stockLevels: truck.stockLevels.map((sl) => {
      const entry = breakdownMap.get(`${truck.id}|${sl.part.id}`) ?? { job: 0, restock: 0 };
      return { ...sl, jobQuantity: entry.job, restockQuantity: entry.restock };
    }),
  }));

  return NextResponse.json({ trucks: trucksWithBreakdown });
}

const createTruckSchema = z.object({ label: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!canManageTrucksAndLimits((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Only a manager or admin can add trucks" }, { status: 403 });
  }
  const parsed = createTruckSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const truck = await prisma.truck.create({ data: { label: parsed.data.label } });
  return NextResponse.json({ truck }, { status: 201 });
}
