import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { performCheckout } from "@/lib/checkout";

// POST /api/inventory/checkout/batch — check a whole cart out to a truck
// in one transaction. Either every line moves or nothing does.
const batchSchema = z
  .object({
    truckId: z.string().min(1),
    warehouseId: z.string().optional().nullable(),
    checkoutType: z.enum(["JOB_USE", "RESTOCK"]),
    jobNumber: z.string().trim().optional(),
    items: z
      .array(z.object({ partId: z.string().min(1), quantity: z.number().int().positive() }))
      .min(1)
      .max(200),
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

export async function POST(req: NextRequest) {
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
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const outcome = await performCheckout({
    userId: session.user.id,
    role: (session.user as { role?: string }).role,
    ...parsed.data,
  });

  return NextResponse.json(outcome.body, { status: outcome.status });
}
