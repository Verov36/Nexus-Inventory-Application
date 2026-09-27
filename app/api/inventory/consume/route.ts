import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWorkTruck } from "@/lib/truck-counts";
import { consumeFromTruck } from "@/lib/consume";
import { idempotencyKeyFrom } from "@/lib/idempotency";
import { withOrg } from "@/lib/with-org";

const schema = z.object({
  truckId: z.string().min(1),
  jobNumber: z.string().trim().min(1).max(64),
  items: z
    .array(z.object({ partId: z.string().min(1), quantity: z.number().int().positive().max(10_000) }))
    .min(1)
    .max(200),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().max(200).optional(),
});

// POST /api/inventory/consume — record parts used on a job, straight off the
// truck. A tech on their own truck; managers and admins on any truck.
// Send an Idempotency-Key header (or idempotencyKey in the body) so a retry
// after a dropped connection can't record the same parts twice.
async function handlePOST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const role = (session.user as { role?: string }).role;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const truck = await prisma.truck.findUnique({ where: { id: parsed.data.truckId }, select: { techId: true } });
  if (!truck) return NextResponse.json({ error: "Truck not found" }, { status: 404 });
  if (!canWorkTruck(role, session.user.id, truck)) {
    return NextResponse.json({ error: "You can only record parts used from your own truck." }, { status: 403 });
  }

  const outcome = await consumeFromTruck({
    truckId: parsed.data.truckId,
    jobNumber: parsed.data.jobNumber,
    items: parsed.data.items,
    notes: parsed.data.notes,
    performedById: session.user.id,
    idempotencyKey: idempotencyKeyFrom(req.headers, parsed.data.idempotencyKey),
    callerScope: `user:${session.user.id}`,
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export const POST = withOrg(handlePOST);
