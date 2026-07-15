import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canRunReports } from "@/lib/roles";
import { generateUsageSummary, getTransactionRows } from "@/lib/reports";

// GET /api/reports/weekly?from=2026-07-01&to=2026-07-08&format=json|csv
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!canRunReports((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const format = req.nextUrl.searchParams.get("format") ?? "json";

  if (!from || !to) {
    return NextResponse.json({ error: "from and to date query params are required" }, { status: 400 });
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (format === "csv") {
    const rows = await getTransactionRows(fromDate, toDate);
    const csv = toCsv(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="parts-usage-${from}-to-${to}.csv"`,
      },
    });
  }

  const summary = await generateUsageSummary(fromDate, toDate);
  return NextResponse.json({ summary });
}

function toCsv(rows: Awaited<ReturnType<typeof getTransactionRows>>) {
  const header = ["Date", "Tech", "SKU", "Part", "Quantity", "Checkout type", "Job number", "Flagged overage"];
  const lines = rows.map((r) => {
    return [
      new Date(r.createdAt).toISOString(),
      r.performedBy?.name ?? "",
      r.part?.sku ?? "",
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
