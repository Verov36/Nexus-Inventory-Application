import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canManageUsers, ROLES, MAX_DESIGNATED_RECEIVERS } from "@/lib/roles";
import { z } from "zod";

const updateSchema = z.object({
  role: z.enum(ROLES).optional(),
  canReceiveParts: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const actingRole = (session?.user as { role?: string })?.role;
  if (!canManageUsers(actingRole)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.role === undefined && parsed.data.canReceiveParts === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const data: { role?: (typeof ROLES)[number]; canReceiveParts?: boolean } = {};

  if (parsed.data.role !== undefined) {
    const touchesAdminTier =
      parsed.data.role === "SUPER_ADMIN" ||
      parsed.data.role === "ADMIN" ||
      target.role === "SUPER_ADMIN" ||
      target.role === "ADMIN";
    if (touchesAdminTier && actingRole !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Only a super admin can change Admin or Super Admin permissions" },
        { status: 403 }
      );
    }
    if (target.role === "SUPER_ADMIN" && parsed.data.role !== "SUPER_ADMIN") {
      const remainingSuperAdmins = await prisma.user.count({
        where: { role: "SUPER_ADMIN", id: { not: target.id } },
      });
      if (remainingSuperAdmins === 0) {
        return NextResponse.json(
          { error: "Can't demote the last remaining super admin" },
          { status: 409 }
        );
      }
    }
    data.role = parsed.data.role;
  }

  if (parsed.data.canReceiveParts !== undefined) {
    if (target.role === "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "The super admin always has receiving access — no need to toggle it" },
        { status: 400 }
      );
    }
    if (parsed.data.canReceiveParts === true && !target.canReceiveParts) {
      const currentCount = await prisma.user.count({
        where: { canReceiveParts: true, role: { not: "SUPER_ADMIN" } },
      });
      if (currentCount >= MAX_DESIGNATED_RECEIVERS) {
        return NextResponse.json(
          {
            error: `Only ${MAX_DESIGNATED_RECEIVERS} people (besides the super admin) can be designated to receive parts at once. Remove someone else's access first.`,
          },
          { status: 409 }
        );
      }
    }
    data.canReceiveParts = parsed.data.canReceiveParts;
  }

  const user = await prisma.user.update({
    where: { id: params.id },
    data,
    select: { id: true, name: true, email: true, role: true, canReceiveParts: true, createdAt: true },
  });
  return NextResponse.json({ user });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const actingRole = (session?.user as { role?: string })?.role;
  if (!canManageUsers(actingRole)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if ((target.role === "SUPER_ADMIN" || target.role === "ADMIN") && actingRole !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Only a super admin can delete an Admin or Super Admin account" },
      { status: 403 }
    );
  }
  if (session?.user?.id === params.id) {
    return NextResponse.json({ error: "You can't delete your own account" }, { status: 400 });
  }
  if (target.role === "SUPER_ADMIN") {
    const remainingSuperAdmins = await prisma.user.count({
      where: { role: "SUPER_ADMIN", id: { not: target.id } },
    });
    if (remainingSuperAdmins === 0) {
      return NextResponse.json({ error: "Can't delete the last remaining super admin" }, { status: 409 });
    }
  }

  try {
    await prisma.user.delete({ where: { id: params.id } });
  } catch {
    return NextResponse.json(
      {
        error:
          "This user has inventory history tied to their account (receipts, checkouts, or justifications) and can't be deleted. Consider changing their role instead to revoke access.",
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
