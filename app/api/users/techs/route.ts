import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits } from "@/lib/roles";

export async function GET() {
  const session = await auth();
  if (!canManageTrucksAndLimits((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const techs = await prisma.user.findMany({
    where: { role: "TRUCK_TECH" },
    select: { id: true, name: true, truck: { select: { id: true, label: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ techs });
}
