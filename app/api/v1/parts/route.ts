import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readJson, withApiKey } from "@/lib/api";
import { defaultMarkupPct } from "@/lib/pricing";
import { partDto, partSelect } from "@/lib/api-present";

// GET /api/v1/parts?q=&category=&cursor=&limit=
// Catalog search by name, SKU or barcode. Cursor-paginated: pass back
// nextCursor until it's null.
async function handleGET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim().slice(0, 100) ?? "";
  const category = sp.get("category")?.trim() || undefined;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 100);
  const cursor = sp.get("cursor") || undefined;

  const rows = await prisma.part.findMany({
    where: {
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
              { barcodeValue: { equals: q } },
            ],
          }
        : {}),
      ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
    },
    select: partSelect,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const markup = await defaultMarkupPct();
  const page = rows.slice(0, limit);
  return NextResponse.json({
    parts: page.map((p) => partDto(p, markup)),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  });
}

const money = z.number().nonnegative().max(99_999_999.99).nullable().optional();
const upsertSchema = z.object({
  parts: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(64),
        name: z.string().trim().min(1).max(200),
        description: z.string().trim().max(2000).nullable().optional(),
        category: z.string().trim().max(100).nullable().optional(),
        // Defaults to the SKU. Must be unique within the company.
        barcode: z.string().trim().min(1).max(128).optional(),
        unitCost: money,
        listPrice: money,
      })
    )
    .min(1)
    .max(500),
});

// PUT /api/v1/parts { parts: [...] } — create or update parts by SKU, e.g.
// the Field App's one-time catalog import. Safe to re-run. Each row reports
// its own result, so one bad row doesn't sink the batch; store the returned
// ids against your parts.
async function handlePUT(req: NextRequest) {
  const read = await readJson(req, upsertSchema);
  if ("response" in read) return read.response;
  const results: { sku: string; id?: string; status: "created" | "updated" | "error"; error?: string }[] = [];
  for (const row of read.data.parts) {
    const data = {
      name: row.name,
      barcodeValue: row.barcode ?? row.sku,
      ...(row.description !== undefined ? { description: row.description } : {}),
      ...(row.category !== undefined ? { category: row.category || null } : {}),
      ...(row.unitCost !== undefined ? { unitCost: row.unitCost } : {}),
      ...(row.listPrice !== undefined ? { listPrice: row.listPrice } : {}),
    };
    try {
      const existing = await prisma.part.findFirst({ where: { sku: row.sku }, select: { id: true } });
      const part = existing
        ? await prisma.part.update({ where: { id: existing.id }, data, select: { id: true } })
        : await prisma.part.create({ data: { sku: row.sku, ...data }, select: { id: true } });
      results.push({ sku: row.sku, id: part.id, status: existing ? "updated" : "created" });
    } catch (err) {
      const duplicate = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      results.push({
        sku: row.sku,
        status: "error",
        error: duplicate ? "Barcode already belongs to another part." : "Couldn't save this row.",
      });
      if (!duplicate) console.error("Part upsert failed:", err);
    }
  }
  return NextResponse.json({ results });
}

export const GET = withApiKey(handleGET);
export const PUT = withApiKey(handlePUT);
