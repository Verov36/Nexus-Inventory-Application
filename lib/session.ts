import { prisma } from "@/lib/prisma";

// However active a session is, it ends this long after sign-in.
const ABSOLUTE_MAX_SECONDS = Number(process.env.SESSION_ABSOLUTE_MAX_DAYS || 7) * 24 * 60 * 60;

export type SessionClaims = {
  sub?: string;
  sv?: number;
  authAt?: number;
  name?: string | null;
  role?: unknown;
  canReceiveParts?: unknown;
  [key: string]: unknown;
};

/**
 * Re-reads the account behind a session token. Returns the token with fresh
 * role/name/receiving claims, or null when the session must end: the account
 * is gone, deactivated, its sessionVersion moved past the one stamped into
 * the token at sign-in (password changed or reset, or deactivated), or it
 * was signed in longer ago than the absolute session lifetime.
 *
 * `sv` is only ever compared, never refreshed, so a session issued before a
 * bump can't bring itself back up to date.
 */
export async function revalidateSession<T extends SessionClaims>(token: T): Promise<T | null> {
  if (!token.sub) return null;
  const authAt = typeof token.authAt === "number" ? token.authAt : 0;
  if (Date.now() / 1000 - authAt > ABSOLUTE_MAX_SECONDS) return null;
  const fresh = await prisma.user.findUnique({
    where: { id: token.sub },
    select: { name: true, role: true, canReceiveParts: true, disabledAt: true, sessionVersion: true },
  });
  if (!fresh || fresh.disabledAt || fresh.sessionVersion !== (token.sv ?? 0)) return null;
  token.name = fresh.name;
  token.role = fresh.role;
  token.canReceiveParts = fresh.canReceiveParts;
  return token;
}
