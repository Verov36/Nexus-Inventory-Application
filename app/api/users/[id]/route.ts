import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canManageUsers, ROLES, MAX_DESIGNATED_RECEIVERS } from "@/lib/roles";
import { z } from "zod";
import bcrypt from "bcryptjs";

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(ROLES).optional(),
  canReceiveParts: z.boolean().optional(),
  // false = deactivate (can't sign in, existing sessions end), true = reactivate.
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  const session = await auth();
  const actingRole = (session?.user as { role?: string })?.role;
  if (!canManageUsers(actingRole)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, email, password, role, canReceiveParts, active } = parsed.data;
  if (
    name === undefined &&
    email === undefined &&
    password === undefined &&
    role === undefined &&
    canReceiveParts === undefined &&
    active === undefined
  ) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Editing basic profile fields (name/email/password) on an Admin or Super
  // Admin account is also restricted to a super admin, same as role changes —
  // otherwise an Admin could quietly take over another Admin's account by
  // changing their email/password.
  const targetIsAdminTier = target.role === "SUPER_ADMIN" || target.role === "ADMIN";
  if ((name !== undefined || email !== undefined || password !== undefined) && targetIsAdminTier) {
    if (actingRole !== "SUPER_ADMIN" && session?.user?.id !== target.id) {
      return NextResponse.json(
        { error: "Only a super admin (or the account owner) can edit an Admin or Super Admin's details" },
        { status: 403 }
      );
    }
  }

  const data: {
    name?: string;
    email?: string;
    passwordHash?: string;
    role?: (typeof ROLES)[number];
    canReceiveParts?: boolean;
    disabledAt?: Date | null;
    sessionVersion?: { increment: number };
  } = {};

  if (name !== undefined) data.name = name;

  if (email !== undefined && email !== target.email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Another user already has that email" }, { status: 409 });
    }
    data.email = email;
  }

  if (password !== undefined) {
    data.passwordHash = await bcrypt.hash(password, 10);
    // Whoever held the old password is signed out everywhere.
    data.sessionVersion = { increment: 1 };
  }

  if (role !== undefined) {
    const touchesAdminTier = role === "SUPER_ADMIN" || role === "ADMIN" || targetIsAdminTier;
    if (touchesAdminTier && actingRole !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Only a super admin can change Admin or Super Admin permissions" },
        { status: 403 }
      );
    }
    if (target.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
      const remainingSuperAdmins = await prisma.user.count({
        where: { role: "SUPER_ADMIN", disabledAt: null, id: { not: target.id } },
      });
      if (remainingSuperAdmins === 0) {
        return NextResponse.json(
          { error: "Can't demote the last remaining super admin" },
          { status: 409 }
        );
      }
    }
    data.role = role;
  }

  if (canReceiveParts !== undefined) {
    if (target.role === "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "The super admin always has receiving access — no need to toggle it" },
        { status: 400 }
      );
    }
    if (canReceiveParts === true && !target.canReceiveParts) {
      const currentCount = await prisma.user.count({
        where: { canReceiveParts: true, disabledAt: null, role: { not: "SUPER_ADMIN" } },
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
    data.canReceiveParts = canReceiveParts;
  }

  if (active !== undefined && active !== !target.disabledAt) {
    if (session?.user?.id === target.id) {
      return NextResponse.json({ error: "You can't deactivate your own account" }, { status: 400 });
    }
    if (targetIsAdminTier && actingRole !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Only a super admin can deactivate or reactivate an Admin or Super Admin" },
        { status: 403 }
      );
    }
    if (!active && target.role === "SUPER_ADMIN") {
      const remainingSuperAdmins = await prisma.user.count({
        where: { role: "SUPER_ADMIN", disabledAt: null, id: { not: target.id } },
      });
      if (remainingSuperAdmins === 0) {
        return NextResponse.json({ error: "Can't deactivate the last active super admin" }, { status: 409 });
      }
    }
    data.disabledAt = active ? null : new Date();
    if (!active) {
      data.sessionVersion = { increment: 1 };
      // A deactivated person keeps no designated-receiver slot.
      data.canReceiveParts = false;
    }
  }

  const user = await prisma.$transaction(async (tx) => {
    // A user who stops being a Truck Tech shouldn't stay attached to a truck —
    // otherwise the truck looks "assigned" to someone who can no longer check
    // parts out to it, and no tech can be put on it without a manual unassign.
    // Same for someone being deactivated: free their truck for the next tech.
    if ((role !== undefined && role !== "TRUCK_TECH" && target.role === "TRUCK_TECH") || active === false) {
      await tx.truck.updateMany({ where: { techId: target.id }, data: { techId: null } });
    }
    if (active === false) {
      await tx.passwordResetToken.updateMany({ where: { userId: target.id, usedAt: null }, data: { usedAt: new Date() } });
    }
    return tx.user.update({
      where: { id: params.id },
      data,
      select: { id: true, name: true, email: true, role: true, canReceiveParts: true, disabledAt: true, createdAt: true },
    });
  });
  return NextResponse.json({ user });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
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
      where: { role: "SUPER_ADMIN", disabledAt: null, id: { not: target.id } },
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
          "This user has inventory history tied to their account (receipts, checkouts, or justifications) and can't be deleted. Deactivate them instead — that blocks sign-in and ends their sessions while keeping the history.",
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
