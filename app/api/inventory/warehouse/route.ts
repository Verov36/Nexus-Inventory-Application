import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const stockLevels = await prisma.stockLevel.findMany({
    where: { locationType: "WAREHOUSE" },
    include: { part: true },
    orderBy: { part: { name: "asc" } },
  });

  const items = stockLevels.map((sl) => ({
    partId: sl.part.id,
    sku: sl.part.sku,
    name: sl.part.name,
    category: sl.part.category,
    barcodeValue: sl.part.barcodeValue,
    quantity: sl.quantity,
    reorderThreshold: sl.part.reorderThreshold,
    lowStock: sl.quantity <= sl.part.reorderThreshold,
    updatedAt: sl.updatedAt,
  }));

  const format = req.nextUrl.searchParams.get("format");
  if (format === "csv") {
    const header = ["SKU", "Name", "Category", "Quantity", "Reorder threshold", "Low stock"];
    const lines = items.map((i) =>
      [i.sku, i.name, i.category ?? "", i.quantity, i.reorderThreshold, i.lowStock ? "Yes" : "No"]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="warehouse-inventory-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ items });
}
