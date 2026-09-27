import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits } from "@/lib/roles";
import { InsufficientStockError } from "@/lib/inventory";
import { CountStateConflict, applyCount, canWorkTruck, loadCount, summarizeCount } from "@/lib/truck-counts";

const reviewSchema = z.object({ decision: z.enum(["APPLY", "DISCARD"]) });

// POST /api/truck-counts/:id/review { decision: "APPLY" | "DISCARD" }
// APPLY posts the count to the truck as ADJUSTMENTs (see applyCount).
// Managers only, SUBMITTED counts only, and not by the person who ran the
// count — a count someone applies to their own numbers checks nothing. (The
// super admin is exempt so a one-person shop isn't stuck.) DISCARD is also
// allowed for whoever started an OPEN count (a tech abandoning their own).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
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
    // Conditional on the status the caller saw, so a discard can't land on
    // a count that was applied a moment earlier.
    const discarded = await prisma.truckCount.updateMany({
      where: { id: count.id, status: isManager ? { in: ["OPEN", "SUBMITTED"] } : "OPEN" },
      data: { status: "DISCARDED", reviewedById: userId, reviewedAt: new Date() },
    });
    if (discarded.count === 0) {
      return NextResponse.json({ error: "This count was already applied or discarded." }, { status: 409 });
    }
    return NextResponse.json({ count: { id: count.id, status: "DISCARDED" } });
  }

  // APPLY
  if (!isManager) {
    return NextResponse.json({ error: "Only a manager or admin can apply a count." }, { status: 403 });
  }
  if (count.status === "OPEN") {
    return NextResponse.json(
      { error: "This count is still in progress. Whoever is counting submits it first, then it can be applied." },
      { status: 409 }
    );
  }
  if (count.status !== "SUBMITTED") {
    return NextResponse.json({ error: `This count is already ${count.status.toLowerCase()}.` }, { status: 409 });
  }
  if (count.startedById === userId && role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "You ran this count, so someone else has to review and apply it." },
      { status: 403 }
    );
  }
  const summary = summarizeCount(count.lines);
  if (summary.uncountedLines > 0) {
    return NextResponse.json(
      { error: `${summary.uncountedLines} lines have no counted quantity — finish the count before applying it.` },
      { status: 400 }
    );
  }

  try {
    const posted = await prisma.$transaction((tx) => applyCount(tx, count.id, userId), { timeout: 30_000 });
    const short = posted.filter((p) => p.delta < 0).reduce((n, p) => n - p.delta, 0);
    const over = posted.filter((p) => p.delta > 0).reduce((n, p) => n + p.delta, 0);
    return NextResponse.json({
      count: { id: count.id, status: "APPLIED" },
      adjustments: posted.length,
      unitsShort: short,
      unitsOver: over,
      movedDuringCount: posted.filter((p) => p.movedSince !== 0).length,
    });
  } catch (err) {
    if (err instanceof CountStateConflict) {
      return NextResponse.json({ error: "This count was already applied or discarded." }, { status: 409 });
    }
    if (err instanceof InsufficientStockError) {
      // Shouldn't happen — the truck row is locked and the target is computed
      // from it — but never let a count overdraw stock.
      return NextResponse.json({ error: "Stock changed while applying — nothing was changed. Try again." }, { status: 409 });
    }
    console.error("Applying truck count failed:", err);
    return NextResponse.json({ error: "Something went wrong applying this count — nothing was changed." }, { status: 500 });
  }
}
