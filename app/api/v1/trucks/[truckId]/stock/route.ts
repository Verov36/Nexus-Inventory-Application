import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, withApiKey } from "@/lib/api";
import { defaultMarkupPct } from "@/lib/pricing";
import { partDto, partSelect } from "@/lib/api-present";

// GET /api/v1/trucks/{truckId}/stock — live on-hand for one truck.
async function handleGET(_req: NextRequest, ctx: { params: Promise<{ truckId: string }> }) {
  const { truckId } = await ctx.params;
  const truck = await prisma.truck.findUnique({ where: { id: truckId }, select: { id: true, label: true, active: true } });
  if (!truck) return apiError(404, "not_found", "Truck not found.");
  const levels = await prisma.stockLevel.findMany({
    where: { truckId, warehouseId: null, quantity: { gt: 0 } },
    select: { quantity: true, part: { select: partSelect } },
    orderBy: { part: { name: "asc" } },
  });
  const markup = await defaultMarkupPct();
  return NextResponse.json({
    truck,
    stock: levels.map((l) => ({ quantity: l.quantity, part: partDto(l.part, markup) })),
  });
}

export const GET = withApiKey(handleGET);
