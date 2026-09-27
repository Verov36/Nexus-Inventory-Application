import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageUsers } from "@/lib/roles";
import { currentOrgId } from "@/lib/tenant";
import { withOrg } from "@/lib/with-org";

const select = {
  id: true,
  name: true,
  defaultMarkupPct: true,
  currency: true,
  timezone: true,
  externalId: true,
  branches: { select: { id: true, name: true, timezone: true, active: true, externalId: true }, orderBy: { createdAt: "asc" as const } },
};

// GET /api/organization: your company's settings and branches.
async function handleGET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: currentOrgId() }, select });
  return NextResponse.json({ organization });
}

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  // Applied to parts that have no list price of their own.
  defaultMarkupPct: z.number().min(0).max(1000).optional(),
  timezone: z
    .string()
    .trim()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone")
    .optional(),
});

// PATCH /api/organization: admins only.
async function handlePATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManageUsers((session.user as { role?: string }).role)) {
    return NextResponse.json({ error: "Only an admin can change company settings" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const organization = await prisma.organization.update({
    where: { id: currentOrgId() },
    data: parsed.data,
    select,
  });
  return NextResponse.json({ organization });
}

export const GET = withOrg(handleGET);
export const PATCH = withOrg(handlePATCH);
