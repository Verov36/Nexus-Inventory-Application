import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canReviewJustifications } from "@/lib/roles";

// GET /api/justifications?status=PENDING
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!canReviewJustifications((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const status = req.nextUrl.searchParams.get("status") as
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | null;

  const justifications = await prisma.overageJustification.findMany({
    where: status ? { status } : undefined,
    include: {
      truck: { include: { tech: { select: { name: true } } } },
      submittedBy: { select: { name: true } },
      transaction: { include: { part: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ justifications });
}
