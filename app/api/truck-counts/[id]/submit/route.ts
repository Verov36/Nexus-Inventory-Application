import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canWorkTruck, loadCount, summarizeCount } from "@/lib/truck-counts";

// POST /api/truck-counts/:id/submit — the count is finished and ready for a
// manager. Every line must have a counted quantity (0 is fine, blank isn't).
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;

  const count = await loadCount(params.id);
  if (!count) return NextResponse.json({ error: "Count not found" }, { status: 404 });
  if (!canWorkTruck(role, session.user.id, count.truck)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (count.status !== "OPEN") {
    return NextResponse.json({ error: `This count is already ${count.status.toLowerCase()}.` }, { status: 409 });
  }

  const summary = summarizeCount(count.lines);
  if (summary.uncountedLines > 0) {
    const missing = summary.lines.filter((l) => l.countedQty === null).map((l) => l.part.name);
    return NextResponse.json(
      {
        error: `${summary.uncountedLines} ${summary.uncountedLines === 1 ? "part hasn't" : "parts haven't"} been counted yet: ${missing
          .slice(0, 5)
          .join(", ")}${missing.length > 5 ? "…" : ""}. Enter 0 if none are on the truck.`,
        uncounted: missing,
      },
      { status: 400 }
    );
  }

  const submittedAt = new Date();
  const claimed = await prisma.truckCount.updateMany({
    where: { id: count.id, status: "OPEN" },
    data: { status: "SUBMITTED", submittedAt },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ error: "This count was already submitted or closed." }, { status: 409 });
  }
  // The tech learns the totals once it's submitted, not before (blind count).
  return NextResponse.json({ count: { id: count.id, status: "SUBMITTED", submittedAt }, ...summary, lines: undefined });
}
