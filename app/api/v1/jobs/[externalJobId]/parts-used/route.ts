import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, readJson, withApiKey } from "@/lib/api";
import { consumeFromTruck } from "@/lib/consume";
import { idempotencyKeyFrom } from "@/lib/idempotency";
import { partsUsedOnJob } from "@/lib/reverse";
import { serviceAccountId } from "@/lib/service-account";

const schema = z.object({
  jobNumber: z.string().trim().min(1).max(64),
  truckId: z.string().min(1),
  usedBy: z.object({ externalUserId: z.string().trim().min(1).max(100), name: z.string().trim().max(120).optional() }),
  // The Field App sets this when a manager or dispatcher records parts for a
  // tech; it skips the "rides this truck" check.
  onBehalf: z.boolean().optional(),
  items: z
    .array(z.object({ partId: z.string().min(1), quantity: z.number().int().positive().max(10_000) }))
    .min(1)
    .max(200),
  notes: z.string().trim().max(500).optional(),
});

type Ctx = { params: Promise<{ externalJobId: string }> };

// POST /api/v1/jobs/{externalJobId}/parts-used  (Idempotency-Key required)
async function handlePOST(req: NextRequest, ctx: Ctx, key: { organizationId: string }) {
  const { externalJobId } = await ctx.params;
  const idempotencyKey = idempotencyKeyFrom(req.headers);
  if (!idempotencyKey) {
    return apiError(400, "idempotency_key_required", "Send an Idempotency-Key header so retries can't record parts twice.");
  }
  const read = await readJson(req, schema);
  if ("response" in read) return read.response;
  const body = read.data;

  if (!body.onBehalf) {
    const onCrew = await prisma.truckCrew.findFirst({
      where: { truckId: body.truckId, externalUserId: body.usedBy.externalUserId },
      select: { id: true },
    });
    if (!onCrew) {
      return apiError(403, "not_assigned_to_truck", "That user isn't assigned to this truck. Assign them, or set onBehalf for a manager/dispatcher.");
    }
  }

  const outcome = await consumeFromTruck({
    truckId: body.truckId,
    jobNumber: body.jobNumber,
    externalJobId,
    items: body.items,
    notes: body.notes,
    performedById: await serviceAccountId(),
    performedByExternal: { id: body.usedBy.externalUserId, name: body.usedBy.name },
    idempotencyKey,
    callerScope: `api:${key.organizationId}`,
  });
  if (!outcome.ok) {
    const code =
      (outcome.body.code as string | undefined) ??
      (outcome.status === 404 ? "not_found" : outcome.status === 409 ? "conflict" : "internal_error");
    const { error, code: _code, ...details } = outcome.body;
    return apiError(outcome.status, code, String(error), details);
  }
  const consumed = outcome.body.consumed as {
    partId: string;
    sku: string;
    name: string;
    quantity: number;
    remainingOnTruck: number;
    transactionId: string;
    unitCost: number | null;
    unitPrice: number | null;
  }[];
  return NextResponse.json(
    {
      externalJobId,
      jobNumber: outcome.body.jobNumber,
      replayed: outcome.body.replayed,
      lines: consumed.map((c) => ({
        lineId: c.transactionId,
        partId: c.partId,
        sku: c.sku,
        name: c.name,
        quantity: c.quantity,
        unitCost: c.unitCost,
        unitPrice: c.unitPrice,
        remainingOnTruck: c.remainingOnTruck,
      })),
    },
    { status: 201 }
  );
}

// GET /api/v1/jobs/{externalJobId}/parts-used
// Every line net of reversals, with the cost and price frozen at time of use.
async function handleGET(_req: NextRequest, ctx: Ctx) {
  const { externalJobId } = await ctx.params;
  const used = await partsUsedOnJob(externalJobId);
  return NextResponse.json(
    used ?? { job: { externalId: externalJobId, jobNumber: null }, lines: [], totals: { cost: 0, price: 0, unpricedLines: 0 } }
  );
}

export const POST = withApiKey(handlePOST);
export const GET = withApiKey(handleGET);
