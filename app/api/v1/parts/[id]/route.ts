import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, withApiKey } from "@/lib/api";
import { defaultMarkupPct } from "@/lib/pricing";
import { partDto, partSelect } from "@/lib/api-present";

// GET /api/v1/parts/{id}
async function handleGET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const part = await prisma.part.findUnique({ where: { id }, select: partSelect });
  if (!part) return apiError(404, "not_found", "Part not found.");
  return NextResponse.json({ part: partDto(part, await defaultMarkupPct()) });
}

export const GET = withApiKey(handleGET);
