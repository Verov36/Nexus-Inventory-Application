import { createHash, randomBytes } from "crypto";
import { prisma, type Tx } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant";

// Organization API keys: "inv_live_" + 32 random bytes. Only the SHA-256 is
// stored, so a database leak doesn't hand out working keys; the key itself is
// returned exactly once, when it's issued.

const PREFIX = "inv_live_";
/** When a key is rotated, the old one keeps working this long. */
export const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

export function hashKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Issues a new key for the organization in context. With `rotate`, every
 * other live key of the organization expires after the grace period instead
 * of immediately, so the caller can switch over without an outage.
 */
export async function issueApiKey(tx: Tx, name: string, opts: { rotate?: boolean } = {}) {
  const key = PREFIX + randomBytes(32).toString("base64url");
  if (opts.rotate) {
    await tx.apiKey.updateMany({
      where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(Date.now() + ROTATION_GRACE_MS) } }] },
      data: { expiresAt: new Date(Date.now() + ROTATION_GRACE_MS) },
    });
  }
  const record = await tx.apiKey.create({
    data: { name, prefix: key.slice(0, PREFIX.length + 6), hash: hashKey(key) },
    select: { id: true, name: true, prefix: true, createdAt: true },
  });
  return { key, record };
}

export type AuthenticatedKey = { apiKeyId: string; organizationId: string };

/**
 * Looks up the organization a presented key belongs to. Null for unknown,
 * revoked or expired keys. Keys are looked up by hash across every
 * organization (the key is what identifies the organization).
 */
export async function authenticateApiKey(presented: string | null | undefined): Promise<AuthenticatedKey | null> {
  if (!presented || !presented.startsWith(PREFIX) || presented.length > 200) return null;
  const hash = hashKey(presented);
  const now = new Date();
  const record = await runUnscoped("API key lookup by hash", () =>
    prisma.apiKey.findUnique({ where: { hash }, select: { id: true, organizationId: true, revokedAt: true, expiresAt: true, lastUsedAt: true } })
  );
  if (!record || record.revokedAt || (record.expiresAt && record.expiresAt <= now)) return null;
  // Last-used is informational; write it at most once a minute per key.
  if (!record.lastUsedAt || now.getTime() - record.lastUsedAt.getTime() > 60_000) {
    await runUnscoped("API key last-used stamp", () =>
      prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: now } })
    ).catch(() => {});
  }
  return { apiKeyId: record.id, organizationId: record.organizationId };
}
