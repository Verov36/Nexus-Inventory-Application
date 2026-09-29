import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/email";

/**
 * A one-time link to /reset-password for this user; any earlier unused link
 * stops working. Only the SHA-256 of the token is stored.
 */
export async function createPasswordLink(userId: string, ttlMinutes: number) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000) },
    }),
  ]);
  return `${appBaseUrl()}/reset-password?token=${token}`;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
