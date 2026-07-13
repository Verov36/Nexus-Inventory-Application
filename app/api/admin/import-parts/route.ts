import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/roles";

/**
 * POST /api/admin/import-parts
 * Body: { csv: string }
 * Expected header row: sku,name,category,barcodeValue,unitCost,reorderThreshold
 * Only sku, name, and barcodeValue are required per row.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isSuperAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Only the super admin can run a mass import" }, { status: 403 });
  }

  const { csv } = await req.json();
  if (typeof csv !== "string" || !csv.trim()) {
    return NextResponse.json({ error: "csv text is required" }, { status: 400 });
  }

  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
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
  };

  const results = { created: 0, updated: 0, skipped: [] as { line: number; reason: string }[] };

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const cols = raw.split(",").map((c) => c.trim());
    const sku = cols[idx.sku];
    const name = cols[idx.name];
    const barcodeValue = cols[idx.barcodeValue];

    if (!sku || !name || !barcodeValue) {
      results.skipped.push({ line: i + 1, reason: "Missing sku, name, or barcodeValue" });
      continue;
    }

    const category = idx.category >= 0 ? cols[idx.category] || undefined : undefined;
    const unitCostRaw = idx.unitCost >= 0 ? cols[idx.unitCost] : undefined;
    const unitCost = unitCostRaw ? Number(unitCostRaw) : undefined;
    const reorderThresholdRaw = idx.reorderThreshold >= 0 ? cols[idx.reorderThreshold] : undefined;
    const reorderThreshold = reorderThresholdRaw ? Number(reorderThresholdRaw) : 0;

    try {
      const existing = await prisma.part.findUnique({ where: { sku } });
      if (existing) {
        await prisma.part.update({
          where: { sku },
          data: { name, category, unitCost, reorderThreshold, barcodeValue },
        });
        results.updated++;
      } else {
        await prisma.part.create({
          data: { sku, name, category, unitCost, reorderThreshold, barcodeValue },
        });
        results.created++;
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
