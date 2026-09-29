import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageUsers } from "@/lib/roles";
import { issueApiKey } from "@/lib/api-keys";
import { withOrg } from "@/lib/with-org";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManageUsers((session.user as { role?: string }).role)) {
    return NextResponse.json({ error: "Only an admin can manage API keys" }, { status: 403 });
  }
  return null;
}

// GET /api/api-keys: this company's keys (never the keys themselves).
async function handleGET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const keys = await prisma.apiKey.findMany({
    select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ keys });
}

const createSchema = z.object({ name: z.string().trim().min(1).max(80) });

// POST /api/api-keys { name }: the key is in the response once, never again.
async function handlePOST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Give the key a name." }, { status: 400 });
  const { key, record } = await prisma.$transaction((tx) => issueApiKey(tx, parsed.data.name));
  return NextResponse.json({ key, record }, { status: 201 });
}

export const GET = withOrg(handleGET);
export const POST = withOrg(handlePOST);
