import { AsyncLocalStorage } from "node:async_hooks";

// Which organization the current request is acting for. Set once per request
// (withOrg for signed-in routes, the API-key middleware for /api/v1, runAsOrg
// for jobs like the report cron) and read by the Prisma extension in
// lib/prisma.ts, which scopes every query on an organization-owned table to it.
//
// No context at all is an error, not "everything": a query that reaches the
// database without one throws TenantContextMissing. Code that genuinely has
// to cross organizations (sign-in by email, first-run setup, the cron loop)
// says so with runUnscoped and a reason.

type TenantContext = { organizationId: string } | { unscoped: string };

// One instance per process, kept on globalThis like the Prisma client in
// lib/prisma.ts: when modules are re-evaluated (dev hot reload, test module
// resets) the cached client must keep reading the same storage that
// runAsOrg writes to, or every query would look context-less.
const globalForTenant = globalThis as unknown as { tenantStorage?: AsyncLocalStorage<TenantContext> };
const storage = (globalForTenant.tenantStorage ??= new AsyncLocalStorage<TenantContext>());

export class TenantContextMissing extends Error {
  constructor(model: string, operation: string) {
    super(`${model}.${operation} ran with no organization context — wrap the caller in withOrg/runAsOrg or runUnscoped.`);
    this.name = "TenantContextMissing";
  }
}

// Both helpers await `fn` *inside* the context. Prisma queries are lazy — a
// query only runs when something awaits it — so returning an un-awaited
// query from the callback would execute it after the context had ended.
export function runAsOrg<T>(organizationId: string, fn: () => T | PromiseLike<T>): Promise<T> {
  if (!organizationId) throw new Error("runAsOrg needs an organization id");
  return storage.run({ organizationId }, async () => await fn());
}

/** Runs `fn` with organization scoping switched off. Keep these rare and give a reason. */
export function runUnscoped<T>(reason: string, fn: () => T | PromiseLike<T>): Promise<T> {
  return storage.run({ unscoped: reason }, async () => await fn());
}

export function tenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/** The acting organization. Throws outside an organization context. */
export function currentOrgId(): string {
  const ctx = storage.getStore();
  if (!ctx || !("organizationId" in ctx)) throw new Error("No organization in context");
  return ctx.organizationId;
}
