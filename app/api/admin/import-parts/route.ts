import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roles";

/**
 * POST /api/admin/import-parts
 * Body: { csv: string, warehouseId: string }
 * Expected header row: sku,name,barcodeValue,category,unitCost,reorderThreshold,initialQuantity
 * Only sku, name, and barcodeValue are required per row. If initialQuantity is
 * present and > 0, a warehouse StockLevel and a RECEIVE transaction are
 * created too — otherwise the part exists in the catalog with zero stock,
 * which won't show up on the inventory page until it's received normally.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isSuperAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Only the super admin can run a mass import" }, { status: 403 });
  }
  const userId = session!.user!.id!;

  const { csv, warehouseId } = await req.json();
  if (typeof csv !== "string" || !csv.trim()) {
    return NextResponse.json({ error: "csv text is required" }, { status: 400 });
  }

  const lines = csv.trim().split(/\r?\n/);
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
  };

  if (idx.initialQuantity >= 0 && !warehouseId) {
    return NextResponse.json(
      { error: "warehouseId is required when the CSV includes an initialQuantity column" },
      { status: 400 }
    );
  }

  const results = {
    created: 0,
    updated: 0,
    stocked: 0,
    skipped: [] as { line: number; reason: string }[],
  };

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

    const category = idx.category >= 0 ? cols[idx.category]?.trim() || undefined : undefined;
    const unitCostRaw = idx.unitCost >= 0 ? cols[idx.unitCost]?.trim() : undefined;
    const unitCost = unitCostRaw ? Number(unitCostRaw) : undefined;
    const reorderThresholdRaw = idx.reorderThreshold >= 0 ? cols[idx.reorderThreshold]?.trim() : undefined;
    const reorderThreshold = reorderThresholdRaw ? Number(reorderThresholdRaw) : 0;
    const initialQuantityRaw = idx.initialQuantity >= 0 ? cols[idx.initialQuantity]?.trim() : undefined;
    const initialQuantity = initialQuantityRaw ? Number(initialQuantityRaw) : 0;

    try {
      const existing = await prisma.part.findUnique({ where: { sku } });
      let partId: string;
      if (existing) {
        const updated = await prisma.part.update({
          where: { sku },
          data: { name, category, unitCost, reorderThreshold, barcodeValue },
        });
        partId = updated.id;
        results.updated++;
      } else {
        const created = await prisma.part.create({
          data: { sku, name, category, unitCost, reorderThreshold, barcodeValue },
        });
        partId = created.id;
        results.created++;
      }

      if (initialQuantity > 0 && warehouseId) {
        await prisma.$transaction(async (tx) => {
          const stockLevel = await tx.stockLevel.findFirst({
            where: { partId, warehouseId, truckId: null },
          });
          if (stockLevel) {
            await tx.stockLevel.update({
              where: { id: stockLevel.id },
              data: { quantity: { increment: initialQuantity } },
            });
          } else {
            await tx.stockLevel.create({
              data: { partId, warehouseId, locationType: "WAREHOUSE", quantity: initialQuantity },
            });
          }
          await tx.inventoryTransaction.create({
            data: {
              type: "RECEIVE",
              partId,
              quantity: initialQuantity,
              toLocationType: "WAREHOUSE",
              toWarehouseId: warehouseId,
              performedById: userId,
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
