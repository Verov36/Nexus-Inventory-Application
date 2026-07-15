import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canEditParts } from "@/lib/roles";
import { z } from "zod";

const bulkSchema = z.union([
  z.object({ mode: z.literal("flat"), value: z.number().int().min(0) }),
  z.object({ mode: z.literal("percentOfStock"), percent: z.number().min(1).max(100) }),
]);

// POST /api/parts/bulk-reorder-threshold
// mode "flat": sets reorderThreshold = value for every part currently at 0.
// mode "percentOfStock": for every part with warehouse stock, sets
// reorderThreshold = round(currentQuantity * percent / 100), minimum 1 —
// a quick way to seed sensible starting points from a fresh import rather
// than leaving everything at the default of 0.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!canEditParts((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Only a warehouse manager or manager can do this" }, { status: 403 });
  }

  const parsed = bulkSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.mode === "flat") {
    const result = await prisma.part.updateMany({
      where: { reorderThreshold: 0 },
      data: { reorderThreshold: parsed.data.value },
    });
    return NextResponse.json({ updated: result.count });
  }

  // percentOfStock — needs each part's current warehouse quantity, so this
  // can't be a single updateMany; loop it.
  const stockLevels = await prisma.stockLevel.findMany({
    where: { locationType: "WAREHOUSE" },
    include: { part: true },
  });
  let updated = 0;
  for (const sl of stockLevels) {
    if (sl.part.reorderThreshold !== 0) continue; // don't clobber thresholds already set manually
    const threshold = Math.max(1, Math.round((sl.quantity * parsed.data.percent) / 100));
    await prisma.part.update({ where: { id: sl.part.id }, data: { reorderThreshold: threshold } });
    updated++;
  }
  return NextResponse.json({ updated });
}
