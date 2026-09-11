import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// First-run setup. Only does anything while the database has zero users —
// the moment the first super admin exists this endpoint is inert, so it
// can't be used to add accounts later.

export async function GET() {
  const users = await prisma.user.count();
  return NextResponse.json({ needsSetup: users === 0 });
}

const setupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  warehouseName: z.string().trim().min(1).max(120).default("Main warehouse"),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-checked inside the transaction so two simultaneous setup posts
      // can't both create a super admin.
      const users = await tx.user.count();
      if (users > 0) throw new AlreadySetUp();

      const user = await tx.user.create({
        data: { name: parsed.data.name, email: parsed.data.email, passwordHash, role: "SUPER_ADMIN" },
        select: { id: true, email: true },
      });
      const warehouse =
        (await tx.warehouse.findFirst({ orderBy: { createdAt: "asc" } })) ??
        (await tx.warehouse.create({ data: { id: "main-warehouse", name: parsed.data.warehouseName } }));
      await tx.reportSchedule.upsert({
        where: { id: "default-schedule" },
        update: {},
        create: { id: "default-schedule", frequencyDays: 7 },
      });
      return { user, warehouse };
    });

    return NextResponse.json({ ok: true, warehouseId: result.warehouse.id, email: result.user.email }, { status: 201 });
  } catch (err) {
    if (err instanceof AlreadySetUp) {
      return NextResponse.json({ error: "This app is already set up — sign in instead." }, { status: 409 });
    }
    console.error("Setup failed:", err);
    return NextResponse.json({ error: "Setup failed — check the database connection and try again." }, { status: 500 });
  }
}

class AlreadySetUp extends Error {}
