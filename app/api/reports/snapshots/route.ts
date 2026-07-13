import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canRunReports } from "@/lib/roles";

export async function GET() {
  const session = await auth();
  if (!canRunReports((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const snapshots = await prisma.reportSnapshot.findMany({
    orderBy: { generatedAt: "desc" },
    take: 26, // ~6 months of weekly snapshots
  });
  return NextResponse.json({
    snapshots: snapshots.map((s) => ({
      id: s.id,
      rangeFrom: s.rangeFrom,
      rangeTo: s.rangeTo,
      generatedAt: s.generatedAt,
      summary: JSON.parse(s.summaryJson),
    })),
  });
}
