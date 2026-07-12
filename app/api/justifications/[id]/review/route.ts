import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";

const reviewSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if ((session.user as { role?: string }).role !== "MANAGER") {
    return NextResponse.json({ error: "Only managers can review overage justifications" }, { status: 403 });
  }

  const parsed = reviewSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const justification = await prisma.overageJustification.update({
    where: { id: params.id },
    data: {
      status: parsed.data.decision,
      reviewedById: session.user.id,
      reviewedAt: new Date(),
    },
  });

  return NextResponse.json({ justification });
}
