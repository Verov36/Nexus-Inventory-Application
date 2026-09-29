import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJson, withApiKey } from "@/lib/api";
import { idempotencyKeyFrom } from "@/lib/idempotency";
import { reverseConsumption } from "@/lib/reverse";
import { serviceAccountId } from "@/lib/service-account";

const schema = z.object({
  quantity: z.number().int().positive().max(10_000),
  reason: z.string().trim().min(1).max(500),
  usedBy: z.object({ externalUserId: z.string().trim().min(1).max(100), name: z.string().trim().max(120).optional() }).optional(),
});

// POST /api/v1/jobs/{externalJobId}/parts-used/{lineId}/reverse  (Idempotency-Key required)
// Puts parts back on the truck they came from (wrong part, not installed).
async function handlePOST(
  req: NextRequest,
  ctx: { params: Promise<{ externalJobId: string; lineId: string }> },
  key: { organizationId: string }
) {
  const { externalJobId, lineId } = await ctx.params;
  const idempotencyKey = idempotencyKeyFrom(req.headers);
  if (!idempotencyKey) {
    return apiError(400, "idempotency_key_required", "Send an Idempotency-Key header so retries can't reverse twice.");
  }
  const read = await readJson(req, schema);
  if ("response" in read) return read.response;

  const outcome = await reverseConsumption({
    lineId,
    externalJobId,
    quantity: read.data.quantity,
    reason: read.data.reason,
    performedById: await serviceAccountId(),
    performedByExternal: read.data.usedBy ? { id: read.data.usedBy.externalUserId, name: read.data.usedBy.name } : undefined,
    idempotencyKey,
    callerScope: `api:${key.organizationId}`,
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export const POST = withApiKey(handlePOST);
