import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageUsers } from "@/lib/roles";
import { withOrg } from "@/lib/with-org";

// DELETE /api/api-keys/{id}: revoke immediately. The row stays for the record.
async function handleDELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManageUsers((session.user as { role?: string }).role)) {
    return NextResponse.json({ error: "Only an admin can manage API keys" }, { status: 403 });
  }
  const revoked = await prisma.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (revoked.count === 0) return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export const DELETE = withOrg(handleDELETE);
