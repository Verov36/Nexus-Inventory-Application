import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { performCheckout } from "@/lib/checkout";
import { withOrg } from "@/lib/with-org";

// POST /api/inventory/checkout — single-part checkout. Kept for older
// clients; the cart checkout at /api/inventory/checkout/batch is the same
// logic for many parts at once.
const checkoutSchema = z
  .object({
    partId: z.string().min(1),
    truckId: z.string().min(1),
    warehouseId: z.string().optional().nullable(),
    quantity: z.number().int().positive(),
    checkoutType: z.enum(["JOB_USE", "RESTOCK"]),
    jobNumber: z.string().trim().optional(),
    // Only present when the tech is resolving a limit block on this same request
    justification: z
      .object({
        explanation: z.string().trim().min(1),
        relatedJobNumbers: z.array(z.string().trim().min(1)).min(1),
      })
      .optional(),
  })
  .refine((d) => d.checkoutType === "RESTOCK" || !!d.jobNumber, {
    message: "jobNumber is required for JOB_USE checkouts",
    path: ["jobNumber"],
  });

async function handlePOST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { partId, quantity, ...rest } = parsed.data;

  const outcome = await performCheckout({
    userId: session.user.id,
    role: (session.user as { role?: string }).role,
    ...rest,
    items: [{ partId, quantity }],
  });

  if (outcome.ok) {
    return NextResponse.json({ transaction: outcome.body.transactions[0] }, { status: 201 });
  }
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export const POST = withOrg(handlePOST);
