import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiKey } from "@/lib/api";

// GET /api/v1/trucks?externalUserId=&branchExternalId=
// Trucks a Field App user rides (their crew assignment), or every truck in a
// branch, or every truck.
async function handleGET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const externalUserId = sp.get("externalUserId") || undefined;
  const branchExternalId = sp.get("branchExternalId") || undefined;
  const trucks = await prisma.truck.findMany({
    where: {
      active: true,
      ...(externalUserId ? { crew: { some: { externalUserId } } } : {}),
      ...(branchExternalId ? { branch: { externalId: branchExternalId } } : {}),
    },
    select: {
      id: true,
      label: true,
      branch: { select: { id: true, externalId: true, name: true } },
      crew: { select: { externalUserId: true, name: true } },
    },
    orderBy: { label: "asc" },
  });
  return NextResponse.json({ trucks });
}

export const GET = withApiKey(handleGET);
