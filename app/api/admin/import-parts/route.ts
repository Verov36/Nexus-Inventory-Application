import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roles";
import { resolveWarehouseId } from "@/lib/inventory";

/**
 * POST /api/admin/import-parts
 * Body: { csv: string, warehouseId?: string }
 * Expected header row: sku,name,barcodeValue,category,unitCost,reorderThreshold,initialQuantity,
 *                      supplier,supplierPartNumber,reorderQty
 * Only sku, name, and barcodeValue are required per row. If initialQuantity is
 * present and > 0, a warehouse StockLevel and a RECEIVE transaction are
 * created too — otherwise the part exists in the catalog with zero stock,
 * which won't show up on the inventory page until it's received normally.
 *
 * On re-import of an existing SKU, only the columns actually present in the
 * CSV are updated — a catalog re-import without a reorderThreshold column no
 * longer wipes every manually-set reorder point back to 0.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isSuperAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Only the super admin can run a mass import" }, { status: 403 });
  }
  const userId = session!.user!.id!;

  let body: { csv?: unknown; warehouseId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const { csv } = body;
  if (typeof csv !== "string" || !csv.trim()) {
    return NextResponse.json({ error: "csv text is required" }, { status: 400 });
  }

  // Excel and Windows editors often prefix a UTF-8 BOM, which would make the
  // first header read as "﻿sku" and fail the required-column check.
  const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const required = ["sku", "name", "barcodevalue"];
  for (const col of required) {
    if (!header.includes(col)) {
      return NextResponse.json(
        { error: `Missing required column "${col}". Header row must include: ${required.join(", ")}` },
        { status: 400 }
      );
    }
  }

  const idx = {
    sku: header.indexOf("sku"),
    name: header.indexOf("name"),
    barcodeValue: header.indexOf("barcodevalue"),
    category: header.indexOf("category"),
    unitCost: header.indexOf("unitcost"),
    reorderThreshold: header.indexOf("reorderthreshold"),
    initialQuantity: header.indexOf("initialquantity"),
    supplier: header.indexOf("supplier"),
    supplierPartNumber: header.indexOf("supplierpartnumber"),
    reorderQty: header.indexOf("reorderqty"),
  };

  let warehouseId: string | null = null;
  if (idx.initialQuantity >= 0) {
    warehouseId = await resolveWarehouseId(typeof body.warehouseId === "string" ? body.warehouseId : undefined);
    if (!warehouseId) {
      return NextResponse.json(
        { error: "The CSV includes an initialQuantity column but no warehouse exists to stock — run the seed first." },
        { status: 400 }
      );
    }
  }

  const results = {
    created: 0,
    updated: 0,
    stocked: 0,
    skipped: [] as { line: number; reason: string }[],
  };

  const seenSkus = new Set<string>();
  const seenBarcodes = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const cols = parseCsvLine(raw);
    const sku = cols[idx.sku]?.trim();
    const name = cols[idx.name]?.trim();
    const barcodeValue = cols[idx.barcodeValue]?.trim();

    if (!sku || !name || !barcodeValue) {
      results.skipped.push({ line: i + 1, reason: "Missing sku, name, or barcodeValue" });
      continue;
    }
    if (seenSkus.has(sku.toLowerCase())) {
      results.skipped.push({ line: i + 1, reason: `Duplicate SKU ${sku} earlier in this file` });
      continue;
    }
    if (seenBarcodes.has(barcodeValue)) {
      results.skipped.push({ line: i + 1, reason: `Duplicate barcode ${barcodeValue} earlier in this file` });
      continue;
    }
    seenSkus.add(sku.toLowerCase());
    seenBarcodes.add(barcodeValue);

    const categoryRaw = idx.category >= 0 ? cols[idx.category]?.trim() : undefined;
    const category = idx.category >= 0 ? categoryRaw || null : undefined;

    const unitCost = parseOptionalNumber(idx.unitCost >= 0 ? cols[idx.unitCost] : undefined);
    if (unitCost === "invalid") {
      results.skipped.push({ line: i + 1, reason: `unitCost "${cols[idx.unitCost]}" is not a number` });
      continue;
    }
    const reorderThreshold = parseOptionalNumber(idx.reorderThreshold >= 0 ? cols[idx.reorderThreshold] : undefined);
    if (reorderThreshold === "invalid" || (typeof reorderThreshold === "number" && (reorderThreshold < 0 || !Number.isInteger(reorderThreshold)))) {
      results.skipped.push({ line: i + 1, reason: `reorderThreshold "${cols[idx.reorderThreshold]}" must be a whole number ≥ 0` });
      continue;
    }
    const initialQuantity = parseOptionalNumber(idx.initialQuantity >= 0 ? cols[idx.initialQuantity] : undefined);
    if (initialQuantity === "invalid" || (typeof initialQuantity === "number" && (initialQuantity < 0 || !Number.isInteger(initialQuantity)))) {
      results.skipped.push({ line: i + 1, reason: `initialQuantity "${cols[idx.initialQuantity]}" must be a whole number ≥ 0` });
      continue;
    }
    const supplierRaw = idx.supplier >= 0 ? cols[idx.supplier]?.trim() : undefined;
    const supplier = idx.supplier >= 0 ? supplierRaw || null : undefined;
    const supplierPartNumberRaw = idx.supplierPartNumber >= 0 ? cols[idx.supplierPartNumber]?.trim() : undefined;
    const supplierPartNumber = idx.supplierPartNumber >= 0 ? supplierPartNumberRaw || null : undefined;
    const reorderQty = parseOptionalNumber(idx.reorderQty >= 0 ? cols[idx.reorderQty] : undefined);
    if (reorderQty === "invalid" || (typeof reorderQty === "number" && (reorderQty < 0 || !Number.isInteger(reorderQty)))) {
      results.skipped.push({ line: i + 1, reason: `reorderQty "${cols[idx.reorderQty]}" must be a whole number ≥ 0` });
      continue;
    }

    try {
      // Another part already owning this barcode (under a different SKU)
      // would hit the unique index and abort the row with a raw DB error —
      // give a readable reason instead.
      const barcodeOwner = await prisma.part.findUnique({ where: { barcodeValue }, select: { sku: true } });
      if (barcodeOwner && barcodeOwner.sku !== sku) {
        results.skipped.push({ line: i + 1, reason: `Barcode ${barcodeValue} already belongs to SKU ${barcodeOwner.sku}` });
        continue;
      }

      const existing = await prisma.part.findUnique({ where: { sku } });
      let partId: string;
      if (existing) {
        const updated = await prisma.part.update({
          where: { sku },
          data: {
            name,
            barcodeValue,
            ...(category !== undefined ? { category } : {}),
            ...(unitCost !== undefined ? { unitCost } : {}),
            ...(reorderThreshold !== undefined ? { reorderThreshold } : {}),
            ...(supplier !== undefined ? { supplier } : {}),
            ...(supplierPartNumber !== undefined ? { supplierPartNumber } : {}),
            ...(reorderQty !== undefined ? { reorderQty } : {}),
          },
        });
        partId = updated.id;
        results.updated++;
      } else {
        const created = await prisma.part.create({
          data: {
            sku,
            name,
            barcodeValue,
            category: category ?? undefined,
            unitCost: unitCost ?? undefined,
            reorderThreshold: reorderThreshold ?? 0,
            supplier: supplier ?? undefined,
            supplierPartNumber: supplierPartNumber ?? undefined,
            reorderQty: reorderQty ?? 0,
          },
        });
        partId = created.id;
        results.created++;
      }

      if (typeof initialQuantity === "number" && initialQuantity > 0 && warehouseId) {
        const wid = warehouseId;
        await prisma.$transaction(async (tx) => {
          const stockLevel = await tx.stockLevel.findFirst({
            where: { partId, warehouseId: wid, truckId: null },
          });
          if (stockLevel) {
            await tx.stockLevel.update({
              where: { id: stockLevel.id },
              data: { quantity: { increment: initialQuantity } },
            });
          } else {
            await tx.stockLevel.create({
              data: { partId, warehouseId: wid, locationType: "WAREHOUSE", quantity: initialQuantity },
            });
          }
          await tx.inventoryTransaction.create({
            data: {
              type: "RECEIVE",
              partId,
              quantity: initialQuantity,
              toLocationType: "WAREHOUSE",
              toWarehouseId: wid,
              performedById: userId,
              notes: "Mass import",
            },
          });
        });
        results.stocked++;
      }
    } catch (err) {
      results.skipped.push({
        line: i + 1,
        reason: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ results });
}

/** "" / undefined -> undefined (column blank), bad text -> "invalid", else the number. */
function parseOptionalNumber(raw: string | undefined): number | undefined | "invalid" {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed.replace(/^\$/, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : "invalid";
}

/** Splits one CSV line on commas while respecting "quoted, fields" containing commas. */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
