import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/parts?barcode=XYZ  -> find one part by its label value
export async function GET(req: NextRequest) {
  const barcode = req.nextUrl.searchParams.get("barcode");
  if (!barcode) {
    return NextResponse.json({ error: "barcode query param is required" }, { status: 400 });
  }
  const part = await prisma.part.findUnique({ where: { barcodeValue: barcode } });
  return NextResponse.json({ part });
}

const createPartSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  unitCost: z.number().optional(),
  barcodeValue: z.string().min(1),
  reorderThreshold: z.number().int().min(0).default(0),
});

// POST /api/parts -> create a new part when a scanned barcode has no match yet
export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createPartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const existing = await prisma.part.findUnique({
    where: { barcodeValue: parsed.data.barcodeValue },
  });
  if (existing) {
    return NextResponse.json({ error: "A part with this barcode already exists" }, { status: 409 });
  }
  const part = await prisma.part.create({ data: parsed.data });
  return NextResponse.json({ part }, { status: 201 });
}
