import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canRunReports } from "@/lib/roles";
import { findApplicableLimit } from "@/lib/limits";
import { money, toNumber } from "@/lib/money";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!canRunReports((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const [warehouseLevels, trucks] = await Promise.all([
    prisma.stockLevel.findMany({
      where: { locationType: "WAREHOUSE" },
      include: { part: true },
      orderBy: { part: { name: "asc" } },
    }),
    prisma.truck.findMany({
      where: { active: true },
      include: {
        tech: { select: { name: true } },
        stockLevels: { where: { quantity: { gt: 0 } }, include: { part: true }, orderBy: { part: { name: "asc" } } },
        stockLimits: { include: { part: true } },
      },
      orderBy: { label: "asc" },
    }),
  ]);

  const warehouse = warehouseLevels.map((sl) => {
    const unitCost = sl.part.unitCost === null ? null : toNumber(sl.part.unitCost);
    return {
      partId: sl.part.id,
      sku: sl.part.sku,
      name: sl.part.name,
      category: sl.part.category,
      quantity: sl.quantity,
      reorderThreshold: sl.part.reorderThreshold,
      lowStock: sl.quantity <= sl.part.reorderThreshold,
      unitCost,
      value: unitCost === null ? 0 : money(sl.quantity * unitCost),
    };
  });

  const truckData = trucks.map((truck) => {
    const items = truck.stockLevels.map((sl) => {
      const limit = findApplicableLimit(truck.stockLimits, sl.part);
      const unitCost = sl.part.unitCost === null ? null : toNumber(sl.part.unitCost);
      return {
        partId: sl.part.id,
        sku: sl.part.sku,
        name: sl.part.name,
        category: sl.part.category,
        quantity: sl.quantity,
        cap: limit?.maxQty ?? null,
        overCap: limit ? sl.quantity > limit.maxQty : false,
        unitCost,
        value: unitCost === null ? 0 : money(sl.quantity * unitCost),
      };
    });
    return {
      truckId: truck.id,
      label: truck.label,
      tech: truck.tech?.name ?? null,
      value: money(items.reduce((sum, i) => sum + i.value, 0)),
      items,
    };
  });

  const warehouseValue = money(warehouse.reduce((sum, w) => sum + w.value, 0));
  const trucksValue = money(truckData.reduce((sum, t) => sum + t.value, 0));
  const uncostedParts = new Set(
    [...warehouse.filter((w) => w.unitCost === null), ...truckData.flatMap((t) => t.items.filter((i) => i.unitCost === null))].map(
      (i) => i.partId
    )
  ).size;

  const generatedAt = new Date().toISOString();

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const header = [
      "Location",
      "Tech",
      "SKU",
      "Part",
      "Category",
      "Quantity",
      "Unit cost",
      "Value",
      "Cap/Reorder threshold",
      "Flag",
    ];
    const lines: string[] = [];
    for (const w of warehouse) {
      lines.push(
        row([
          "Warehouse",
          "",
          w.sku,
          w.name,
          w.category ?? "",
          w.quantity,
          w.unitCost === null ? "" : w.unitCost.toFixed(2),
          w.unitCost === null ? "" : w.value.toFixed(2),
          w.reorderThreshold,
          w.lowStock ? "Low stock" : "",
        ])
      );
    }
    for (const t of truckData) {
      for (const item of t.items) {
        lines.push(
          row([
            t.label,
            t.tech ?? "",
            item.sku,
            item.name,
            item.category ?? "",
            item.quantity,
            item.unitCost === null ? "" : item.unitCost.toFixed(2),
            item.unitCost === null ? "" : item.value.toFixed(2),
            item.cap ?? "",
            item.overCap ? "Over cap" : "",
          ])
        );
      }
    }
    lines.push(row(["Total", "", "", "", "", "", "", money(warehouseValue + trucksValue).toFixed(2), "", ""]));
    const csv = [row(header), ...lines].join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="inventory-audit-${generatedAt.slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ generatedAt, warehouse, trucks: truckData, warehouseValue, trucksValue, uncostedParts });
}

function row(cols: (string | number)[]) {
  return cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
}
