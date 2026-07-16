import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const transactions = await prisma.inventoryTransaction.findMany({
    where: { partId: params.id },
    include: {
      performedBy: { select: { name: true } },
      partUsage: { include: { job: true } },
      justification: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // RECEIVE/RETURN always increase; CHECKOUT always decreases (from the
  // warehouse's side, which is what this combined log frames everything
  // around); ADJUSTMENT can go either way now that warehouse count
  // corrections exist alongside truck write-offs, so it's read off which
  // side of the transaction actually has a destination.
  const withDirection = transactions.map((t) => {
    let direction: "increase" | "decrease";
    if (t.type === "RECEIVE" || t.type === "RETURN") direction = "increase";
    else if (t.type === "CHECKOUT") direction = "decrease";
    else direction = t.toWarehouseId || t.toTruckId ? "increase" : "decrease";
    return { ...t, direction };
  });

  return NextResponse.json({ transactions: withDirection });
}
