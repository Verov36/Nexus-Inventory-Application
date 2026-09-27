import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { withOrg } from "@/lib/with-org";

// GET /api/parts/search?q=filter -> up to 10 parts matching name or SKU
async function handleGET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ parts: [] });

  const parts = await prisma.part.findMany({
    where: {
      OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }],
    },
    select: { id: true, sku: true, name: true, category: true },
    take: 10,
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ parts });
}

export const GET = withOrg(handleGET);
