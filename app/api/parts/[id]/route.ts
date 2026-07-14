import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canEditParts } from "@/lib/roles";
import { z } from "zod";

// Deliberately excludes sku and barcodeValue — changing either would desync
// from labels already printed and stuck on bins/shelves. Relabeling is a
// receiving-desk action (print a fresh label), not a quiet catalog edit.
const updateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().optional().nullable(),
  unitCost: z.number().optional().nullable(),
  reorderThreshold: z.number().int().min(0).optional(),
  description: z.string().optional().nullable(),
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
  if (!canEditParts((session?.user as { role?: string })?.role)) {
    return NextResponse.json(
      { error: "Only a warehouse manager or manager can edit parts" },
      { status: 403 }
    );
  }

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const part = await prisma.part.update({
    where: { id: params.id },
    data: parsed.data,
  });
  return NextResponse.json({ part });
}
