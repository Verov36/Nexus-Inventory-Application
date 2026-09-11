import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canWorkTruck, loadCount, summarizeCount } from "@/lib/truck-counts";

// POST /api/truck-counts/:id/submit — the count is finished and ready for a
// manager. Every line must have a counted quantity (0 is fine, blank isn't).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
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

  const updated = await prisma.truckCount.update({
    where: { id: count.id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
    select: { id: true, status: true, submittedAt: true },
  });
  return NextResponse.json({ count: updated, ...summary, lines: undefined });
}
