import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits, canViewFleet } from "@/lib/roles";
import { canWorkTruck, countInclude, summarizeCount } from "@/lib/truck-counts";

// GET /api/truck-counts?truckId=&status=OPEN|SUBMITTED|APPLIED|DISCARDED
// Managers see every truck's counts; a tech sees only their own truck's.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (!canViewFleet(role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const truckId = req.nextUrl.searchParams.get("truckId") ?? undefined;
  const statusParam = req.nextUrl.searchParams.get("status");
  const statuses = statusParam
    ? (statusParam.split(",").filter((s) => ["OPEN", "SUBMITTED", "APPLIED", "DISCARDED"].includes(s)) as (
        | "OPEN"
        | "SUBMITTED"
        | "APPLIED"
        | "DISCARDED"
      )[])
    : undefined;

  const counts = await prisma.truckCount.findMany({
    where: {
      ...(truckId ? { truckId } : {}),
      ...(statuses && statuses.length ? { status: { in: statuses } } : {}),
      ...(canManageTrucksAndLimits(role) ? {} : { truck: { techId: session.user.id } }),
    },
    include: countInclude,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    counts: counts.map((c) => {
      const summary = summarizeCount(c.lines);
      return {
        id: c.id,
        status: c.status,
        truck: c.truck,
        startedBy: c.startedBy,
        reviewedBy: c.reviewedBy,
        notes: c.notes,
        createdAt: c.createdAt,
        submittedAt: c.submittedAt,
        reviewedAt: c.reviewedAt,
        totalLines: summary.totalLines,
        countedLines: summary.countedLines,
        unitsShort: summary.unitsShort,
        unitsOver: summary.unitsOver,
        varianceValue: summary.varianceValue,
      };
    }),
  });
}

const startSchema = z.object({ truckId: z.string().min(1) });

// POST /api/truck-counts { truckId } — start a count: snapshot what the
// system thinks is on the truck. Only one OPEN/SUBMITTED count per truck.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const truck = await prisma.truck.findUnique({
    where: { id: parsed.data.truckId },
    include: { stockLevels: { where: { quantity: { gt: 0 } } } },
  });
  if (!truck) return NextResponse.json({ error: "Truck not found" }, { status: 404 });
  if (!truck.active) return NextResponse.json({ error: "This truck is deactivated." }, { status: 409 });
  if (!canWorkTruck(role, session.user.id, truck)) {
    return NextResponse.json({ error: "You can only count your own truck." }, { status: 403 });
  }

  const existing = await prisma.truckCount.findFirst({
    where: { truckId: truck.id, status: { in: ["OPEN", "SUBMITTED"] } },
    include: countInclude,
  });
  if (existing) {
    return NextResponse.json(
      {
        error:
          existing.status === "OPEN"
            ? "A count is already in progress for this truck — continue it instead."
            : "A count for this truck is waiting for a manager to review. Ask them to apply or discard it first.",
        count: existing,
      },
      { status: 409 }
    );
  }

  const count = await prisma.truckCount.create({
    data: {
      truckId: truck.id,
      startedById: session.user.id,
      lines: {
        create: truck.stockLevels.map((sl) => ({ partId: sl.partId, expectedQty: sl.quantity })),
      },
    },
    include: countInclude,
  });

  return NextResponse.json({ count }, { status: 201 });
}
