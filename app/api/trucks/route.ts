import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET() {
  const trucks = await prisma.truck.findMany({
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
  const parsed = createTruckSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const truck = await prisma.truck.create({ data: { label: parsed.data.label } });
  return NextResponse.json({ truck }, { status: 201 });
}
