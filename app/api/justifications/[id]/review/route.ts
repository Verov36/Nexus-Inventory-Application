import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canReviewJustifications } from "@/lib/roles";

const reviewSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!canReviewJustifications((session.user as { role?: string }).role)) {
    return NextResponse.json(
      { error: "Only a manager or admin can review overage justifications" },
      { status: 403 }
    );
  }

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

  const existing = await prisma.overageJustification.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "Justification not found" }, { status: 404 });
  if (existing.status !== "PENDING") {
    // Two managers reviewing the same list at once — second decision loses,
    // and gets told so rather than silently flipping the first one.
    return NextResponse.json(
      { error: `This justification was already ${existing.status.toLowerCase()}.`, justification: existing },
      { status: 409 }
    );
  }

  // Approving your own overage checks nothing. (Super admin exempt so a
  // one-person shop isn't stuck.)
  const role = (session.user as { role?: string }).role;
  if (existing.submittedById === session.user.id && role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "You submitted this one, so another manager has to review it." }, { status: 403 });
  }

  // Conditional on still being PENDING: two managers deciding at once, the
  // second one is told it was already decided instead of overwriting it.
  const decided = await prisma.overageJustification.updateMany({
    where: { id: params.id, status: "PENDING" },
    data: {
      status: parsed.data.decision,
      reviewedById: session.user.id,
      reviewedAt: new Date(),
    },
  });
  const justification = await prisma.overageJustification.findUniqueOrThrow({ where: { id: params.id } });
  if (decided.count === 0) {
    return NextResponse.json(
      { error: `This justification was already ${justification.status.toLowerCase()}.`, justification },
      { status: 409 }
    );
  }

  return NextResponse.json({ justification });
}
