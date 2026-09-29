import { Prisma, PrismaClient } from "@prisma/client";
import { TenantContextMissing, tenantContext } from "@/lib/tenant";

// Tables whose rows belong to one organization. Every query on them is
// scoped to the organization in context (lib/tenant.ts). Child tables reached
// only through one of these (TruckCountLine, PartUsage, PasswordResetToken)
// don't carry their own organizationId.
const ORG_MODELS = new Set<string>([
  "Branch",
  "User",
  "Part",
  "Warehouse",
  "Truck",
  "TruckCount",
  "StockLevel",
  "TruckStockLimit",
  "Job",
  "InventoryTransaction",
  "OverageJustification",
  "ReportSchedule",
  "ReportSnapshot",
  "ApiKey",
  "TruckCrew",
]);

type Args = Record<string, unknown> & { where?: object; data?: unknown; create?: object };

function scopeArgs(operation: string, args: Args, organizationId: string): Args {
  const org = { organizationId };
  switch (operation) {
    // Unique lookups keep their unique key at the top level; the extra
    // organization filter rides alongside it.
    case "findUnique":
    case "findUniqueOrThrow":
    case "update":
    case "delete":
      return { ...args, where: { ...args.where, ...org } };
    case "upsert":
      return { ...args, where: { ...args.where, ...org }, create: { ...args.create, ...org } };
    case "findFirst":
    case "findFirstOrThrow":
    case "findMany":
    case "count":
    case "aggregate":
    case "groupBy":
    case "updateMany":
    case "deleteMany":
      return { ...args, where: args.where ? { AND: [args.where, org] } : org };
    case "create":
      return { ...args, data: { ...(args.data as object), ...org } };
    case "createMany":
    case "createManyAndReturn":
      return {
        ...args,
        data: Array.isArray(args.data)
          ? args.data.map((d) => ({ ...d, ...org }))
          : { ...(args.data as object), ...org },
      };
    default:
      throw new Error(`Organization scoping doesn't handle ${operation} — add it to lib/prisma.ts`);
  }
}

type Resolve = () => { organizationId: string } | { unscoped: string } | undefined;

function organizationScope(resolve: Resolve) {
  return Prisma.defineExtension({
    name: "organization-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!ORG_MODELS.has(model)) return query(args);
          const ctx = resolve();
          if (!ctx) throw new TenantContextMissing(model, operation);
          if ("unscoped" in ctx) return query(args);
          return query(scopeArgs(operation, args as Args, ctx.organizationId) as typeof args);
        },
      },
    },
  });
}

function makeClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
  const scoped = base.$extends(organizationScope(tenantContext));
  return { base, scoped };
}

type Clients = ReturnType<typeof makeClient>;
const globalForPrisma = globalThis as unknown as { prismaClients?: Clients };
const clients = globalForPrisma.prismaClients ?? makeClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prismaClients = clients;

/** The app's database client: every query is scoped to the organization in context. */
export const prisma = clients.scoped;

/** A transaction on the scoped client. */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * The unscoped client, for tests and maintenance scripts only. App code must
 * never import it (tests/unit/tenant-guard.test.ts enforces that).
 */
export const rawPrisma: PrismaClient = clients.base;

/**
 * A client permanently scoped to one organization, for tests and scripts
 * that aren't inside a request. Same scoping rules as `prisma`.
 */
export function prismaForOrg(organizationId: string) {
  return clients.base.$extends(organizationScope(() => ({ organizationId })));
}

export { Prisma };
