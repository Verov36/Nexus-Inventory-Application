import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { currentOrgId } from "@/lib/tenant";

/**
 * The organization's integration identity: stock moved through the API is
 * recorded as performed by this account (with the real person's name on
 * each ledger row). It is created deactivated, with an unusable random
 * password and a non-deliverable address, so it can never sign in, and it's
 * hidden from the Users page.
 */
export async function serviceAccountId(): Promise<string> {
  const existing = await prisma.user.findFirst({ where: { isServiceAccount: true }, select: { id: true } });
  if (existing) return existing.id;
  const orgId = currentOrgId();
  try {
    const created = await prisma.user.create({
      data: {
        name: "Field App (integration)",
        email: `integration+${orgId}@service.invalid`,
        passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
        role: "MANAGER",
        isServiceAccount: true,
        disabledAt: new Date(),
      },
      select: { id: true },
    });
    return created.id;
  } catch {
    // Two first calls at once: the other one created it.
    const again = await prisma.user.findFirstOrThrow({ where: { isServiceAccount: true }, select: { id: true } });
    return again.id;
  }
}
