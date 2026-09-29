import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { authenticateApiKey, type AuthenticatedKey } from "@/lib/api-keys";
import { rateLimit } from "@/lib/rate-limit";
import { runAsOrg } from "@/lib/tenant";

// Server-to-server API (/api/v1) — see docs/field-app-integration.md.
// Errors are always { error, code, ...details } so callers can branch on
// `code` without parsing messages.

export function apiError(status: number, code: string, error: string, details: Record<string, unknown> = {}) {
  return NextResponse.json({ error, code, ...details }, { status });
}

function bearer(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

type RouteCtx<P> = { params: Promise<P> };
type Handler<P> = (req: NextRequest, ctx: RouteCtx<P>, key: AuthenticatedKey) => Promise<Response>;

/**
 * Wraps a /api/v1 handler: authenticates the organization API key, applies a
 * per-key rate limit, and runs the handler inside that organization — every
 * query it makes is scoped to the key's organization and nothing else.
 */
export function withApiKey<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<Response> => {
    const key = await authenticateApiKey(bearer(req));
    if (!key) return apiError(401, "unauthorized", "Missing, invalid, revoked or expired API key.");
    const limit = await rateLimit(`api:${key.apiKeyId}`, 1200, 60);
    if (!limit.ok) {
      const res = apiError(429, "rate_limited", "Too many requests for this key. Slow down and retry.");
      res.headers.set("Retry-After", String(limit.retryAfterSeconds));
      return res;
    }
    try {
      return await runAsOrg(key.organizationId, () => handler(req, ctx, key));
    } catch (err) {
      console.error("API request failed:", err);
      return apiError(500, "internal_error", "Something went wrong. Safe to retry with the same Idempotency-Key.");
    }
  };
}

/**
 * Wraps the provisioning endpoint: only the platform key
 * (INVENTORY_PLATFORM_KEY, held by the Field App backend) may create
 * organizations. Refuses everything when the key isn't configured.
 */
export function withPlatformKey<P>(handler: (req: NextRequest, ctx: RouteCtx<P>) => Promise<Response>) {
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<Response> => {
    const expected = process.env.INVENTORY_PLATFORM_KEY;
    if (!expected) return apiError(503, "not_configured", "Provisioning is disabled: INVENTORY_PLATFORM_KEY is not set.");
    const given = bearer(req) ?? "";
    const a = createHash("sha256").update(given).digest();
    const b = createHash("sha256").update(expected).digest();
    if (!timingSafeEqual(a, b)) return apiError(401, "unauthorized", "Invalid platform key.");
    try {
      return await handler(req, ctx);
    } catch (err) {
      console.error("Provisioning request failed:", err);
      return apiError(500, "internal_error", "Something went wrong. Safe to retry.");
    }
  };
}

/** Reads and validates a JSON body; returns the parsed data or an error response. */
export async function readJson<T>(
  req: NextRequest,
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { flatten: () => unknown } } }
): Promise<{ data: T } | { response: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { response: apiError(400, "invalid_json", "Request body must be JSON.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { response: apiError(400, "validation_failed", "Invalid request.", { details: parsed.error.flatten() }) };
  return { data: parsed.data };
}
