import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export async function GET() {
  const trucks = await prisma.truck.findMany({
    include: {
      tech: { select: { id: true, name: true, email: true } },
      stockLevels: { include: { part: true } },
      stockLimits: { include: { part: true } },
    },
    orderBy: { label: "asc" },
  });
  return NextResponse.json({ trucks });
}

const createTruckSchema = z.object({ label: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = createTruckSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const truck = await prisma.truck.create({ data: { label: parsed.data.label } });
  return NextResponse.json({ truck }, { status: 201 });
}
