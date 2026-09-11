import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits } from "@/lib/roles";
import { InsufficientStockError, adjustTruckStock } from "@/lib/inventory";
import { loadCount, summarizeCount, canWorkTruck } from "@/lib/truck-counts";

const reviewSchema = z.object({ decision: z.enum(["APPLY", "DISCARD"]) });

// POST /api/truck-counts/:id/review { decision: "APPLY" | "DISCARD" }
// APPLY posts every variance as an ADJUSTMENT on the truck (shortages come
// off, overages go on) so the live count matches what was physically
// found. Managers only. DISCARD is also allowed for whoever started an
// OPEN count (a tech abandoning their own count).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  const userId = session.user.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const count = await loadCount(params.id);
  if (!count) return NextResponse.json({ error: "Count not found" }, { status: 404 });

  const isManager = canManageTrucksAndLimits(role);
  if (parsed.data.decision === "DISCARD") {
    const ownOpen = count.status === "OPEN" && canWorkTruck(role, userId, count.truck);
    if (!isManager && !ownOpen) {
      return NextResponse.json({ error: "Only a manager can discard a submitted count." }, { status: 403 });
    }
    if (count.status === "APPLIED" || count.status === "DISCARDED") {
      return NextResponse.json({ error: `This count is already ${count.status.toLowerCase()}.` }, { status: 409 });
    }
    const updated = await prisma.truckCount.update({
      where: { id: count.id },
      data: { status: "DISCARDED", reviewedById: userId, reviewedAt: new Date() },
      select: { id: true, status: true },
    });
    return NextResponse.json({ count: updated });
  }

  // APPLY
  if (!isManager) {
    return NextResponse.json({ error: "Only a manager or admin can apply a count." }, { status: 403 });
  }
  if (count.status !== "SUBMITTED" && count.status !== "OPEN") {
    return NextResponse.json({ error: `This count is already ${count.status.toLowerCase()}.` }, { status: 409 });
  }
  const summary = summarizeCount(count.lines);
  if (summary.uncountedLines > 0) {
    return NextResponse.json(
      { error: `${summary.uncountedLines} lines have no counted quantity — finish the count before applying it.` },
      { status: 400 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let adjustments = 0;
      for (const line of summary.lines) {
        if (line.variance === null || line.variance === 0) continue;
        await adjustTruckStock(tx, line.partId, count.truckId, line.variance);
        await tx.inventoryTransaction.create({
          data: {
            type: "ADJUSTMENT",
            partId: line.partId,
            quantity: Math.abs(line.variance),
            ...(line.variance < 0
              ? { fromLocationType: "TRUCK", fromTruckId: count.truckId }
              : { toLocationType: "TRUCK", toTruckId: count.truckId }),
            performedById: userId,
            notes: `Truck count ${count.createdAt.toISOString().slice(0, 10)}: expected ${line.expectedQty}, counted ${line.countedQty}${
              count.notes ? ` — ${count.notes}` : ""
            }`,
          },
        });
        adjustments++;
      }
      const updated = await tx.truckCount.update({
        where: { id: count.id },
        data: { status: "APPLIED", reviewedById: userId, reviewedAt: new Date() },
        select: { id: true, status: true, reviewedAt: true },
      });
      return { updated, adjustments };
    });

    return NextResponse.json({ count: result.updated, adjustments: result.adjustments, ...summary, lines: undefined });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return NextResponse.json(
        {
          error:
            "Stock on this truck changed since the count was taken (returns or write-offs), so the shortages no longer line up. Discard this count and run a fresh one.",
        },
        { status: 409 }
      );
    }
    console.error("Applying truck count failed:", err);
    return NextResponse.json({ error: "Something went wrong applying this count — nothing was changed." }, { status: 500 });
  }
}
