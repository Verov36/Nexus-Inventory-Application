import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, withApiKey } from "@/lib/api";

const schema = z.object({
  label: z.string().trim().min(1).max(80),
  branchExternalId: z.string().trim().min(1).max(100),
  active: z.boolean().optional(),
});

// PUT /api/v1/trucks/external/{externalTruckId} { label, branchExternalId }
// Creates or updates the Inventory truck for a Field App truck. Safe to
// re-run; returns the Inventory truck id to use everywhere else.
async function handlePUT(req: NextRequest, ctx: { params: Promise<{ externalTruckId: string }> }) {
  const { externalTruckId } = await ctx.params;
  if (!externalTruckId || externalTruckId.length > 100) return apiError(400, "validation_failed", "Bad truck id.");
  const read = await readJson(req, schema);
  if ("response" in read) return read.response;
  const body = read.data;

  const branch = await prisma.branch.findFirst({ where: { externalId: body.branchExternalId }, select: { id: true } });
  if (!branch) return apiError(404, "branch_not_found", "Unknown branch — provision it first.");

  const existing = await prisma.truck.findFirst({ where: { externalId: externalTruckId }, select: { id: true } });
  const data = { label: body.label, branchId: branch.id, ...(body.active !== undefined ? { active: body.active } : {}) };
  const select = { id: true, externalId: true, label: true, active: true, branch: { select: { externalId: true, name: true } } };
  const truck = existing
    ? await prisma.truck.update({ where: { id: existing.id }, data, select })
    : await prisma.truck.create({ data: { ...data, externalId: externalTruckId }, select });
  return NextResponse.json({ truck, created: !existing }, { status: existing ? 200 : 201 });
}

export const PUT = withApiKey(handlePUT);
