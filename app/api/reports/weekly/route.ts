import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/reports/weekly?from=2026-07-01&to=2026-07-08&format=json|csv
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const format = req.nextUrl.searchParams.get("format") ?? "json";

  if (!from || !to) {
    return NextResponse.json({ error: "from and to date query params are required" }, { status: 400 });
  }

  const rows = await prisma.inventoryTransaction.findMany({
    where: {
      type: "CHECKOUT",
      createdAt: { gte: new Date(from), lte: new Date(to) },
    },
    include: {
      part: true,
      performedBy: { select: { name: true } },
      partUsage: { include: { job: true } },
      justification: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const jobUse = rows.filter((r) => r.checkoutType === "JOB_USE");
  const restock = rows.filter((r) => r.checkoutType === "RESTOCK");

  const summary = {
    range: { from, to },
    totalCheckouts: rows.length,
    jobUseCount: jobUse.length,
    restockCount: restock.length,
    flaggedOverages: rows.filter((r) => r.justification && r.justification.status === "PENDING").length,
    byTech: groupBy(rows, (r) => r.performedBy.name).map(([tech, items]) => ({
      tech,
      partsCheckedOut: items.reduce((sum, i) => sum + i.quantity, 0),
      jobUseCount: items.filter((i) => i.checkoutType === "JOB_USE").length,
      restockCount: items.filter((i) => i.checkoutType === "RESTOCK").length,
    })),
    byPart: groupBy(rows, (r) => r.part.name).map(([part, items]) => ({
      part,
      quantity: items.reduce((sum, i) => sum + i.quantity, 0),
    })),
    byJob: groupBy(
      rows.filter((r) => r.partUsage),
      (r) => r.partUsage!.job.jobNumber
    ).map(([jobNumber, items]) => ({
      jobNumber,
      parts: items.map((i) => ({ part: i.part.name, quantity: i.quantity })),
    })),
  };

  if (format === "csv") {
    const csv = toCsv(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="parts-usage-${from}-to-${to}.csv"`,
      },
    });
  }

  return NextResponse.json({ summary, transactions: rows });
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return Array.from(map.entries());
}

function toCsv(rows: Awaited<ReturnType<typeof prisma.inventoryTransaction.findMany>>) {
  const header = ["Date", "Tech", "Part", "Quantity", "Checkout type", "Job number", "Flagged overage"];
  const lines = rows.map((r: any) => {
    return [
      new Date(r.createdAt).toISOString(),
      r.performedBy?.name ?? "",
      r.part?.name ?? "",
      r.quantity,
      r.checkoutType ?? "",
      r.partUsage?.job?.jobNumber ?? "",
      r.justification ? r.justification.status : "",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",");
  });
  return [header.join(","), ...lines].join("\n");
}
