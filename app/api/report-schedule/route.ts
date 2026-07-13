import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canRunReports } from "@/lib/roles";
import { z } from "zod";

async function getOrCreateSchedule() {
  const existing = await prisma.reportSchedule.findFirst();
  if (existing) return existing;
  return prisma.reportSchedule.create({ data: { frequencyDays: 7 } });
}

export async function GET() {
  const session = await auth();
  if (!canRunReports((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const schedule = await getOrCreateSchedule();
  return NextResponse.json({ schedule });
}

const updateSchema = z.object({ frequencyDays: z.number().int().min(1).max(90) });

export async function PATCH(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as { role?: string })?.role;
  if (!canRunReports(role) || role === "WAREHOUSE_MANAGER") {
    // Warehouse managers can view/run reports but changing the audit cadence
    // is a manager+ decision.
    return NextResponse.json({ error: "Not authorized to change the report schedule" }, { status: 403 });
  }

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const schedule = await getOrCreateSchedule();
  const nextRunAt = new Date((schedule.lastRunAt ?? new Date()).getTime());
  nextRunAt.setDate(nextRunAt.getDate() + parsed.data.frequencyDays);

  const updated = await prisma.reportSchedule.update({
    where: { id: schedule.id },
    data: {
      frequencyDays: parsed.data.frequencyDays,
      nextRunAt,
      updatedById: session!.user!.id,
    },
  });
  return NextResponse.json({ schedule: updated });
}
