import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canEditParts } from "@/lib/roles";
import { z } from "zod";
import { withOrg } from "@/lib/with-org";
import { defaultMarkupPct, priceFor } from "@/lib/pricing";

// Deliberately excludes sku and barcodeValue — changing either would desync
// from labels already printed and stuck on bins/shelves. Relabeling is a
// receiving-desk action (print a fresh label), not a quiet catalog edit.
const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  category: z.string().trim().optional().nullable(),
  // Decimal(10,2): anything larger would overflow the column.
  unitCost: z.number().nonnegative().max(99_999_999.99).optional().nullable(),
  listPrice: z.number().nonnegative().max(99_999_999.99).optional().nullable(),
  reorderThreshold: z.number().int().min(0).optional(),
  description: z.string().trim().optional().nullable(),
  supplier: z.string().trim().optional().nullable(),
  supplierPartNumber: z.string().trim().optional().nullable(),
  reorderQty: z.number().int().min(0).optional(),
});

async function handleGET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const part = await prisma.part.findUnique({ where: { id: params.id } });
  if (!part) return NextResponse.json({ error: "Part not found" }, { status: 404 });
  const markupPct = await defaultMarkupPct();
  return NextResponse.json({ part, pricing: { ...priceFor(part, markupPct), defaultMarkupPct: markupPct } });
}

async function handlePATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!canEditParts((session.user as { role?: string }).role)) {
    return NextResponse.json(
      { error: "Only a warehouse manager or manager can edit parts" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.part.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Part not found" }, { status: 404 });

  const data = { ...parsed.data };
  // An empty category means "no category", not the literal empty string —
  // otherwise it shows up as its own blank group on the truck inventory page.
  if (data.category === "") data.category = null;
  if (data.description === "") data.description = null;
  if (data.supplier === "") data.supplier = null;
  if (data.supplierPartNumber === "") data.supplierPartNumber = null;

  const part = await prisma.part.update({ where: { id: params.id }, data });
  return NextResponse.json({ part });
}

export const GET = withOrg(handleGET);
export const PATCH = withOrg(handlePATCH);
