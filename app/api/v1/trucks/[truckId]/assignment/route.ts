import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, withApiKey } from "@/lib/api";

const schema = z.object({
  crew: z
    .array(z.object({ externalUserId: z.string().trim().min(1).max(100), name: z.string().trim().max(120).optional() }))
    .max(50),
});

// PUT /api/v1/trucks/{truckId}/assignment { crew: [{ externalUserId, name }] }
// Replaces who rides this truck. Parts-used calls check the tech against it.
async function handlePUT(req: NextRequest, ctx: { params: Promise<{ truckId: string }> }) {
  const { truckId } = await ctx.params;
  const read = await readJson(req, schema);
  if ("response" in read) return read.response;
  const truck = await prisma.truck.findUnique({ where: { id: truckId }, select: { id: true } });
  if (!truck) return apiError(404, "not_found", "Truck not found.");

  const unique = new Map(read.data.crew.map((c) => [c.externalUserId, c]));
  const crew = await prisma.$transaction(async (tx) => {
    await tx.truckCrew.deleteMany({ where: { truckId } });
    if (unique.size) {
      await tx.truckCrew.createMany({
        data: [...unique.values()].map((c) => ({ truckId, externalUserId: c.externalUserId, name: c.name ?? null })),
      });
    }
    return tx.truckCrew.findMany({ where: { truckId }, select: { externalUserId: true, name: true } });
  });
  return NextResponse.json({ truckId, crew });
}

export const PUT = withApiKey(handlePUT);
