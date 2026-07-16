import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits } from "@/lib/roles";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;

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

  // Reconstruct how much of each truck's current stock came from job-use
  // checkouts vs. general restocking. The running StockLevel.quantity is
  // just one merged total (both checkout types add to it the same way), so
  // this is derived from the transaction history rather than stored
  // directly — every checkout already records its type, so this is exact,
  // not an estimate.
  const truckIds = trucks.map((t) => t.id);
  const breakdown =
    truckIds.length > 0
      ? await prisma.inventoryTransaction.groupBy({
          by: ["toTruckId", "partId", "checkoutType"],
          where: { type: "CHECKOUT", toTruckId: { in: truckIds } },
          _sum: { quantity: true },
        })
      : [];

  const breakdownMap = new Map<string, { job: number; restock: number }>();
  for (const row of breakdown) {
    const key = `${row.toTruckId}|${row.partId}`;
    const entry = breakdownMap.get(key) ?? { job: 0, restock: 0 };
    if (row.checkoutType === "JOB_USE") entry.job += row._sum.quantity ?? 0;
    if (row.checkoutType === "RESTOCK") entry.restock += row._sum.quantity ?? 0;
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
