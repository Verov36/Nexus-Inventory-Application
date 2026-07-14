import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canManageUsers, ROLES } from "@/lib/roles";
import { z } from "zod";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await auth();
  if (!canManageUsers((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, canReceiveParts: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users });
}

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const actingRole = (session?.user as { role?: string })?.role;
  if (!canManageUsers(actingRole)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const parsed = createUserSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Only a super admin can create another admin or super admin — an admin
  // shouldn't be able to elevate themselves or a peer.
  if (
    (parsed.data.role === "SUPER_ADMIN" || parsed.data.role === "ADMIN") &&
    actingRole !== "SUPER_ADMIN"
  ) {
    return NextResponse.json(
      { error: "Only a super admin can create Admin or Super Admin accounts" },
      { status: 403 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      passwordHash,
    },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return NextResponse.json({ user }, { status: 201 });
}
