import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canViewWarehouseInventory } from "@/lib/roles";
import { money, toNumber } from "@/lib/money";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!canViewWarehouseInventory((session.user as { role?: string }).role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const stockLevels = await prisma.stockLevel.findMany({
    where: { locationType: "WAREHOUSE" },
    include: { part: true },
    orderBy: { part: { name: "asc" } },
  });

  let items = stockLevels.map((sl) => {
    const unitCost = sl.part.unitCost === null ? null : toNumber(sl.part.unitCost);
    return {
      partId: sl.part.id,
      sku: sl.part.sku,
      name: sl.part.name,
      category: sl.part.category,
      barcodeValue: sl.part.barcodeValue,
      quantity: sl.quantity,
      reorderThreshold: sl.part.reorderThreshold,
      lowStock: sl.quantity <= sl.part.reorderThreshold,
      unitCost,
      value: unitCost === null ? 0 : money(sl.quantity * unitCost),
      updatedAt: sl.updatedAt,
    };
  });

  if (req.nextUrl.searchParams.get("lowStock") === "true") {
    items = items.filter((i) => i.lowStock);
  }

  const format = req.nextUrl.searchParams.get("format");
  if (format === "csv") {
    const header = ["SKU", "Name", "Category", "Quantity", "Unit cost", "Value", "Reorder threshold", "Low stock"];
    const lines = items.map((i) =>
      [
        i.sku,
        i.name,
        i.category ?? "",
        i.quantity,
        i.unitCost === null ? "" : i.unitCost.toFixed(2),
        i.unitCost === null ? "" : i.value.toFixed(2),
        i.reorderThreshold,
        i.lowStock ? "Yes" : "No",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const filenameSuffix = req.nextUrl.searchParams.get("lowStock") === "true" ? "low-stock" : "full";
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="warehouse-inventory-${filenameSuffix}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const totalValue = money(items.reduce((sum, i) => sum + i.value, 0));
  const uncostedParts = items.filter((i) => i.unitCost === null).length;
  return NextResponse.json({ items, totalValue, uncostedParts });
}
