import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canEditParts } from "@/lib/roles";
import { getReorderList } from "@/lib/reorder";
import { money } from "@/lib/money";

// GET /api/reorder[?format=csv] — what to order, grouped by supplier on the client.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!canEditParts((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { items, noReorderPoint } = await getReorderList();
  const openItems = items.filter((i) => !i.orderedAt);
  const estimatedTotal = money(openItems.reduce((sum, i) => sum + i.estimatedCost, 0));

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const header = [
      "Supplier",
      "Supplier part #",
      "SKU",
      "Part",
      "Category",
      "On hand",
      "Reorder point",
      "Order qty",
      "Unit cost",
      "Est. cost",
      "Status",
    ];
    const lines = items.map((i) =>
      row([
        i.supplier ?? "",
        i.supplierPartNumber ?? "",
        i.sku,
        i.name,
        i.category ?? "",
        i.quantity,
        i.reorderThreshold,
        i.orderedQty ?? i.suggestedQty,
        i.unitCost === null ? "" : i.unitCost.toFixed(2),
        i.unitCost === null ? "" : i.estimatedCost.toFixed(2),
        i.orderedAt ? `Ordered ${i.orderedAt.toISOString().slice(0, 10)}` : "To order",
      ])
    );
    return new NextResponse([row(header), ...lines].join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="reorder-list-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ items, noReorderPoint, estimatedTotal });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ordered"), partId: z.string().min(1), quantity: z.number().int().positive() }),
  z.object({ action: z.literal("clear"), partId: z.string().min(1) }),
]);

// POST /api/reorder — mark a part as ordered (so it stops nagging) or clear
// that mark. Receiving the part clears it automatically.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!canEditParts((session.user as { role?: string }).role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const part = await prisma.part.findUnique({ where: { id: parsed.data.partId }, select: { id: true } });
  if (!part) return NextResponse.json({ error: "Part not found" }, { status: 404 });

  const updated = await prisma.part.update({
    where: { id: part.id },
    data:
      parsed.data.action === "ordered"
        ? { orderedAt: new Date(), orderedQty: parsed.data.quantity, orderedById: session.user.id }
        : { orderedAt: null, orderedQty: null, orderedById: null },
    select: { id: true, orderedAt: true, orderedQty: true },
  });
  return NextResponse.json({ part: updated });
}

function row(cols: (string | number)[]) {
  return cols.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
}
