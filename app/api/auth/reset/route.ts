import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const schema = z.object({ token: z.string().min(20), password: z.string().min(8).max(200) });

// POST /api/auth/reset { token, password } — consumes a link from /api/auth/forgot.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!record || record.usedAt || record.expiresAt < new Date() || record.user.disabledAt) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired. Request a new one from the sign-in page." },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const consumed = await prisma.$transaction(async (tx) => {
    // Conditional on usedAt still being null, so two concurrent submissions
    // of the same link can't both set a password.
    const claim = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claim.count === 0) return false;
    // Anyone holding a session from before the reset is signed out.
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    return true;
  });
  if (!consumed) {
    return NextResponse.json(
      { error: "This reset link has already been used. Request a new one from the sign-in page." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, email: record.user.email });
}
