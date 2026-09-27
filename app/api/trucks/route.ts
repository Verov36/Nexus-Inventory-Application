import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits, canViewFleet } from "@/lib/roles";
import { withOrg } from "@/lib/with-org";

async function handleGET() {
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
      // Rows that have been fully returned/written off sit at 0 — hide them
      // so the inventory list doesn't fill up with "0 / cap" lines.
      stockLevels: { where: { quantity: { gt: 0 } }, include: { part: true } },
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
  const [checkoutRows, removalRows, usedRows] = await Promise.all([
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
    prisma.inventoryTransaction.groupBy({
      by: ["fromTruckId", "partId"],
      where: { type: "CONSUME", fromTruckId: { in: truckIds } },
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
  // Parts used on jobs come off the job-loaded bucket first (that's what it
  // was loaded for), then out of general restock.
  for (const row of usedRows) {
    const key = `${row.fromTruckId}|${row.partId}`;
    const entry = breakdownMap.get(key) ?? { job: 0, restock: 0 };
    let usedQty = row._sum.quantity ?? 0;
    const fromJob = Math.min(entry.job, usedQty);
    entry.job -= fromJob;
    usedQty -= fromJob;
    entry.restock = Math.max(0, entry.restock - usedQty);
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
      // The ledger and the live count can disagree (e.g. history from before
      // returns were tracked). Trust the live count: clamp the buckets so
      // job + restock never exceeds what's actually on the truck.
      const job = Math.min(entry.job, sl.quantity);
      const restock = sl.quantity - job;
      return { ...sl, jobQuantity: job, restockQuantity: restock };
    }),
  }));

  return NextResponse.json({ trucks: trucksWithBreakdown });
}

const createTruckSchema = z.object({
  label: z.string().trim().min(1).max(80),
  // Which branch the truck runs out of; defaults to the organization's first.
  branchId: z.string().min(1).optional(),
});

async function handlePOST(req: NextRequest) {
  const session = await auth();
  if (!canManageTrucksAndLimits((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Only a manager or admin can add trucks" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = createTruckSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const duplicate = await prisma.truck.findFirst({
    where: { label: { equals: parsed.data.label, mode: "insensitive" } },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: `There's already a truck labelled "${duplicate.label}"${duplicate.active ? "" : " (deactivated — reactivate it instead)"}.` },
      { status: 409 }
    );
  }
  const branch = parsed.data.branchId
    ? await prisma.branch.findFirst({ where: { id: parsed.data.branchId, active: true }, select: { id: true } })
    : await prisma.branch.findFirst({ where: { active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  const truck = await prisma.truck.create({ data: { label: parsed.data.label, branchId: branch.id } });
  return NextResponse.json({ truck }, { status: 201 });
}

export const GET = withOrg(handleGET);
export const POST = withOrg(handlePOST);
