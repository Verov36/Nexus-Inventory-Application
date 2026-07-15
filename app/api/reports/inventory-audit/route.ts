import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canRunReports } from "@/lib/roles";

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
      include: {
        tech: { select: { name: true } },
        stockLevels: { include: { part: true }, orderBy: { part: { name: "asc" } } },
        stockLimits: { include: { part: true } },
      },
      orderBy: { label: "asc" },
    }),
  ]);

  const warehouse = warehouseLevels.map((sl) => ({
    partId: sl.part.id,
    sku: sl.part.sku,
    name: sl.part.name,
    category: sl.part.category,
    quantity: sl.quantity,
    reorderThreshold: sl.part.reorderThreshold,
    lowStock: sl.quantity <= sl.part.reorderThreshold,
  }));

  const truckData = trucks.map((truck) => ({
    truckId: truck.id,
    label: truck.label,
    tech: truck.tech?.name ?? null,
    items: truck.stockLevels.map((sl) => {
      const limit = truck.stockLimits.find((l) => l.part?.id === sl.part.id);
      return {
        partId: sl.part.id,
        sku: sl.part.sku,
        name: sl.part.name,
        category: sl.part.category,
        quantity: sl.quantity,
        cap: limit?.maxQty ?? null,
        overCap: limit ? sl.quantity > limit.maxQty : false,
      };
    }),
  }));

  const generatedAt = new Date().toISOString();

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const header = ["Location", "Tech", "SKU", "Part", "Category", "Quantity", "Cap/Reorder threshold", "Flag"];
    const lines: string[] = [];
    for (const w of warehouse) {
      lines.push(
        row(["Warehouse", "", w.sku, w.name, w.category ?? "", w.quantity, w.reorderThreshold, w.lowStock ? "Low stock" : ""])
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
            item.cap ?? "",
            item.overCap ? "Over cap" : "",
          ])
        );
      }
    }
    const csv = [row(header), ...lines].join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="inventory-audit-${generatedAt.slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ generatedAt, warehouse, trucks: truckData });
}

function row(cols: (string | number)[]) {
  return cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
}
