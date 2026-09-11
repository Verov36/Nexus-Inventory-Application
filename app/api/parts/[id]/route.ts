import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canEditParts } from "@/lib/roles";
import { z } from "zod";

// Deliberately excludes sku and barcodeValue — changing either would desync
// from labels already printed and stuck on bins/shelves. Relabeling is a
// receiving-desk action (print a fresh label), not a quiet catalog edit.
const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  category: z.string().trim().optional().nullable(),
  unitCost: z.number().nonnegative().optional().nullable(),
  reorderThreshold: z.number().int().min(0).optional(),
  description: z.string().trim().optional().nullable(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const part = await prisma.part.findUnique({ where: { id: params.id } });
  if (!part) return NextResponse.json({ error: "Part not found" }, { status: 404 });
  return NextResponse.json({ part });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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

  const part = await prisma.part.update({ where: { id: params.id }, data });
  return NextResponse.json({ part });
}
