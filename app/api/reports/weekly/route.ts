import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canRunReports } from "@/lib/roles";
import { generateUsageSummary, getTransactionRows } from "@/lib/reports";
import { money, toNumber } from "@/lib/money";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/reports/weekly?from=2026-07-01&to=2026-07-08&format=json|csv
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!canRunReports((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const format = req.nextUrl.searchParams.get("format") ?? "json";

  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "from and to must both be dates in YYYY-MM-DD form" }, { status: 400 });
  }

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  // The "to" day is inclusive: a report for Jul 1–Jul 8 should include
  // everything that happened on the 8th, not stop at midnight going into it.
  const toDate = new Date(`${to}T00:00:00.000Z`);
  toDate.setUTCDate(toDate.getUTCDate() + 1);

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return NextResponse.json({ error: "from and to must be valid dates" }, { status: 400 });
  }
  if (fromDate >= toDate) {
    return NextResponse.json({ error: "from must be on or before to" }, { status: 400 });
  }

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
  const header = [
    "Date",
    "Tech",
    "SKU",
    "Part",
    "Quantity",
    "Unit cost",
    "Line cost",
    "Checkout type",
    "Job number",
    "Flagged overage",
  ];
  const lines = rows.map((r) => {
    const unitCost = r.part?.unitCost === null || r.part?.unitCost === undefined ? null : toNumber(r.part.unitCost);
    return [
      new Date(r.createdAt).toISOString(),
      r.performedBy?.name ?? "",
      r.part?.sku ?? "",
      r.part?.name ?? "",
      r.quantity,
      unitCost === null ? "" : unitCost.toFixed(2),
      unitCost === null ? "" : money(r.quantity * unitCost).toFixed(2),
      r.checkoutType ?? "",
      r.partUsage?.job?.jobNumber ?? "",
      r.justification ? r.justification.status : "",
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",");
  });
  return [header.join(","), ...lines].join("\n");
}
