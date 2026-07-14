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

  return NextResponse.json({ transactions });
}
