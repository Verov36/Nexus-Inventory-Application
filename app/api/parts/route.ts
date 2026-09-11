import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canReceiveWarehouseStock } from "@/lib/roles";

// GET /api/parts?barcode=XYZ  -> find one part by its label value
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const barcode = req.nextUrl.searchParams.get("barcode")?.trim();
  if (!barcode) {
    return NextResponse.json({ error: "barcode query param is required" }, { status: 400 });
  }
  const part = await prisma.part.findUnique({ where: { barcodeValue: barcode } });
  return NextResponse.json({ part });
}

const createPartSchema = z.object({
  sku: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  category: z.string().trim().optional(),
  unitCost: z.number().nonnegative().optional(),
  barcodeValue: z.string().trim().min(1),
  reorderThreshold: z.number().int().min(0).default(0),
});

// POST /api/parts -> create a new part when a scanned barcode has no match yet
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const actingUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, canReceiveParts: true },
  });
  if (!actingUser || !canReceiveWarehouseStock(actingUser.role, actingUser.canReceiveParts)) {
    return NextResponse.json(
      { error: "You're not currently designated to receive warehouse parts." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = createPartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = {
    ...parsed.data,
    category: parsed.data.category || undefined,
    description: parsed.data.description || undefined,
  };

  const [byBarcode, bySku] = await Promise.all([
    prisma.part.findUnique({ where: { barcodeValue: data.barcodeValue } }),
    prisma.part.findUnique({ where: { sku: data.sku } }),
  ]);
  if (byBarcode) {
    return NextResponse.json({ error: "A part with this barcode already exists" }, { status: 409 });
  }
  if (bySku) {
    return NextResponse.json(
      { error: `SKU ${data.sku} is already used by "${bySku.name}" — scan that part's label, or use a different SKU.` },
      { status: 409 }
    );
  }

  try {
    const part = await prisma.part.create({ data });
    return NextResponse.json({ part }, { status: 201 });
  } catch (err) {
    console.error("Create part failed:", err);
    return NextResponse.json({ error: "Couldn't create that part — try again." }, { status: 500 });
  }
}
