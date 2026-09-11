import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits, canViewFleet } from "@/lib/roles";
import { findApplicableLimit } from "@/lib/limits";

const MAX_PARTS = 12;

// GET /api/trucks/:truckId/recent-parts
// The parts most recently checked out to this truck, with what's on the
// truck now and the cap that applies — the "tap to add" strip on the
// checkout screen, so restocking the usual items doesn't need a scan.
export async function GET(_req: NextRequest, { params }: { params: { truckId: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (!canViewFleet(role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const truck = await prisma.truck.findUnique({
    where: { id: params.truckId },
    include: { stockLimits: true, stockLevels: { select: { partId: true, quantity: true } } },
  });
  if (!truck) return NextResponse.json({ error: "Truck not found" }, { status: 404 });
  if (!canManageTrucksAndLimits(role) && truck.techId !== session.user.id) {
    return NextResponse.json({ error: "Not your truck" }, { status: 403 });
  }

  // Prisma's `distinct` is applied after `take`, so pull a window of recent
  // checkouts and de-duplicate here instead.
  const recent = await prisma.inventoryTransaction.findMany({
    where: { type: "CHECKOUT", toTruckId: truck.id },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { part: true },
  });

  const truckQty = new Map(truck.stockLevels.map((sl) => [sl.partId, sl.quantity]));
  const seen = new Set<string>();
  const parts = [];
  for (const row of recent) {
    if (seen.has(row.partId)) continue;
    seen.add(row.partId);
    const limit = findApplicableLimit(truck.stockLimits, row.part);
    parts.push({
      id: row.part.id,
      sku: row.part.sku,
      name: row.part.name,
      category: row.part.category,
      barcodeValue: row.part.barcodeValue,
      truckQty: truckQty.get(row.partId) ?? 0,
      cap: limit?.maxQty ?? null,
      lastCheckedOutAt: row.createdAt,
    });
    if (parts.length >= MAX_PARTS) break;
  }

  return NextResponse.json({ parts });
}
