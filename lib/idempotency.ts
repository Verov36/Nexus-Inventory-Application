import type { Prisma } from "@prisma/client";

export type StoredResponse = { status: number; body: Record<string, unknown> };

/**
 * Runs `work` at most once per (scope, key). Must be called inside the same
 * transaction as the writes it protects.
 *
 * The key row is inserted first. If another request holding the same key is
 * mid-flight, Postgres makes this insert wait until that transaction ends;
 * if it committed, this request gets its stored response back (`replayed`)
 * and does nothing. If `work` throws, the whole transaction — key row
 * included — rolls back, so a failed attempt can simply be retried.
 */
export async function oncePerKey(
  tx: Prisma.TransactionClient,
  scope: string,
  key: string | undefined,
  work: () => Promise<StoredResponse>
): Promise<StoredResponse & { replayed: boolean }> {
  if (!key) return { ...(await work()), replayed: false };

  const inserted = await tx.$executeRaw`
    INSERT INTO "IdempotencyRecord" ("scope", "key", "status", "body")
    VALUES (${scope}, ${key}, 0, '{}'::jsonb)
    ON CONFLICT DO NOTHING`;
  if (inserted === 0) {
    const prior = await tx.idempotencyRecord.findUniqueOrThrow({ where: { scope_key: { scope, key } } });
    return { status: prior.status, body: prior.body as Record<string, unknown>, replayed: true };
  }

  const result = await work();
  await tx.idempotencyRecord.update({
    where: { scope_key: { scope, key } },
    data: { status: result.status, body: result.body as Prisma.InputJsonValue },
  });
  return { ...result, replayed: false };
}

/** Reads an Idempotency-Key header (or body field), bounded to something sane. */
export function idempotencyKeyFrom(headers: Headers, bodyKey?: unknown): string | undefined {
  const raw = headers.get("idempotency-key") ?? (typeof bodyKey === "string" ? bodyKey : undefined);
  const key = raw?.trim();
  return key && key.length <= 200 ? key : undefined;
}
