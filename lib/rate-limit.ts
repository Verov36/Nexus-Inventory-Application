import { prisma } from "@/lib/prisma";

export type RateLimitResult = { ok: boolean; retryAfterSeconds: number };

/**
 * Counts one hit against `key` in a fixed window and says whether it's still
 * under `limit`. A single atomic upsert, so concurrent requests on any number
 * of app instances all see the same count.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, timezone('utc', now()), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < timezone('utc', now()) - make_interval(secs => ${windowSeconds})
                     THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < timezone('utc', now()) - make_interval(secs => ${windowSeconds})
                           THEN timezone('utc', now()) ELSE "RateLimit"."windowStart" END
    RETURNING "count", "windowStart"
  `;
  // (Times are UTC explicitly: the column has no time zone, Prisma reads it
  // as UTC, and the database server's own zone may be anything.)
  // Roughly one call in 200 clears rows whose window ended a day ago.
  if (Math.random() < 0.005) {
    prisma.$executeRaw`DELETE FROM "RateLimit" WHERE "windowStart" < timezone('utc', now()) - interval '1 day'`.catch(() => {});
  }
  const { count, windowStart } = rows[0];
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000));
  return { ok: count <= limit, retryAfterSeconds };
}

/** Checks several limits (e.g. per-IP and per-account); fails if any is over. */
export async function rateLimitAll(checks: [key: string, limit: number, windowSeconds: number][]) {
  const results = await Promise.all(checks.map(([k, l, w]) => rateLimit(k, l, w)));
  const blocked = results.filter((r) => !r.ok);
  return {
    ok: blocked.length === 0,
    retryAfterSeconds: blocked.length ? Math.max(...blocked.map((r) => r.retryAfterSeconds)) : 0,
  };
}

/**
 * Best-effort client IP. Behind Railway (or any single reverse proxy) the
 * proxy appends the real peer address as the last x-forwarded-for entry, so
 * take the last one — the leading entries are whatever the client claimed.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return headers.get("x-real-ip") ?? "unknown";
}

export function tooManyRequests(retryAfterSeconds: number, message = "Too many attempts. Wait a few minutes and try again.") {
  return Response.json({ error: message }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });
}
