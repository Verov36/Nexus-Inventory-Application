import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canManageTrucksAndLimits } from "@/lib/roles";
import { canWorkTruck, loadCount, summarizeCount } from "@/lib/truck-counts";

type LoadedCount = NonNullable<Awaited<ReturnType<typeof loadCount>>>;

function present(count: LoadedCount, role: string | undefined) {
  const summary = summarizeCount(count.lines);
  // Blind count for techs: they enter what they see without being told what
  // the system expects, which is what makes a count worth anything. Once
  // it's submitted the numbers are visible to everyone involved.
  const showExpected = canManageTrucksAndLimits(role) || count.status !== "OPEN";
  return {
    ...count,
    ...summary,
    lines: summary.lines.map((l) =>
      showExpected ? l : { ...l, expectedQty: null, variance: null, varianceValue: null }
    ),
    unitsShort: showExpected ? summary.unitsShort : null,
    unitsOver: showExpected ? summary.unitsOver : null,
    varianceValue: showExpected ? summary.varianceValue : null,
  };
}

// GET /api/truck-counts/:id — the count with its lines and variances.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
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
  return NextResponse.json({ count: present(count, role) });
}

const patchSchema = z.object({
  lines: z.array(z.object({ partId: z.string().min(1), countedQty: z.number().int().min(0).nullable() })).optional(),
  addPartId: z.string().min(1).optional(),
  notes: z.string().trim().max(2000).optional(),
});

// PATCH /api/truck-counts/:id — save counted quantities, add a part that
// was found on the truck but wasn't in the snapshot, or set notes. OPEN only.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const count = await loadCount(params.id);
  if (!count) return NextResponse.json({ error: "Count not found" }, { status: 404 });
  if (!canWorkTruck(role, session.user.id, count.truck)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (count.status !== "OPEN") {
    return NextResponse.json({ error: `This count is ${count.status.toLowerCase()} and can't be edited.` }, { status: 409 });
  }

  const { lines, addPartId, notes } = parsed.data;
  const lineByPart = new Map(count.lines.map((l) => [l.partId, l]));

  if (addPartId && !lineByPart.has(addPartId)) {
    const part = await prisma.part.findUnique({ where: { id: addPartId }, select: { id: true } });
    if (!part) return NextResponse.json({ error: "Part not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    for (const l of lines ?? []) {
      const existing = lineByPart.get(l.partId);
      if (!existing) continue;
      await tx.truckCountLine.update({ where: { id: existing.id }, data: { countedQty: l.countedQty } });
    }
    if (addPartId && !lineByPart.has(addPartId)) {
      // Something found on the truck that the system had at 0.
      await tx.truckCountLine.create({ data: { countId: count.id, partId: addPartId, expectedQty: 0, countedQty: null } });
    }
    if (notes !== undefined) {
      await tx.truckCount.update({ where: { id: count.id }, data: { notes: notes || null } });
    }
  });

  const updated = await loadCount(params.id);
  return NextResponse.json({ count: present(updated!, role) });
}
