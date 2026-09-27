import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_ORG,
  getPrisma,
  getRawPrisma,
  hasDatabase,
  jsonRequest,
  mockAuthAs,
  resetDatabase,
  seedBasics,
  truckQty,
  type Seeded,
} from "./setup";

// Two companies in one database. Nothing one does may be visible to, or
// change anything belonging to, the other.

const OTHER_ORG = "org_other";

describe.skipIf(!hasDatabase)("organization isolation (real database)", () => {
  let s: Seeded;
  let other: {
    admin: { id: string };
    manager: { id: string };
    tech: { id: string };
    truck: { id: string };
    part: { id: string };
  };

  beforeEach(async () => {
    vi.resetModules();
    await resetDatabase();
    s = await seedBasics();
    await s.prisma.stockLevel.create({
      data: { partId: s.capacitor.id, truckId: s.truck.id, locationType: "TRUCK", quantity: 5 },
    });

    const raw = await getRawPrisma();
    await raw.organization.create({ data: { id: OTHER_ORG, name: "Other Co" } });
    const o = await getPrisma(OTHER_ORG);
    const branch = await o.branch.create({ data: { name: "Other branch" } });
    await o.warehouse.create({ data: { name: "Other warehouse", branchId: branch.id } });
    const admin = await o.user.create({ data: { name: "Olga Admin", email: "olga@other.test", passwordHash: "x", role: "ADMIN" } });
    const manager = await o.user.create({ data: { name: "Omar Manager", email: "omar@other.test", passwordHash: "x", role: "MANAGER" } });
    const tech = await o.user.create({ data: { name: "Otto Tech", email: "otto@other.test", passwordHash: "x", role: "TRUCK_TECH" } });
    const truck = await o.truck.create({ data: { label: "Other truck", techId: tech.id, branchId: branch.id } });
    // Same SKU and barcode as the test org's capacitor: allowed, per organization.
    const part = await o.part.create({ data: { sku: "CAP-45", name: "Their capacitor", barcodeValue: "CAP45", unitCost: "99.00" } });
    other = { admin, manager, tech, truck, part };
  });

  const as = (user: { id: string }, role: string) => mockAuthAs({ id: user.id, role, organizationId: OTHER_ORG });

  it("lists only your own organization's parts, trucks and users", async () => {
    as(other.manager, "MANAGER");
    const trucks = await (await (await import("@/app/api/trucks/route")).GET()).json();
    expect(trucks.trucks.map((t: { id: string }) => t.id)).toEqual([other.truck.id]);

    const search = await import("@/app/api/parts/search/route");
    const found = await (await search.GET(await jsonRequest("/api/parts/search?q=cap", "GET"))).json();
    const names = JSON.stringify(found);
    expect(names).toContain("Their capacitor");
    expect(names).not.toContain("Capacitor 45/5");

    vi.resetModules();
    as(other.admin, "ADMIN");
    const users = await (await (await import("@/app/api/users/route")).GET()).json();
    expect(users.users.map((u: { email: string }) => u.email).sort()).toEqual(
      ["olga@other.test", "omar@other.test", "otto@other.test"]
    );
  });

  it("a barcode scan resolves to your organization's part, never theirs", async () => {
    as(other.tech, "TRUCK_TECH");
    const { GET } = await import("@/app/api/parts/route");
    const body = await (await GET(await jsonRequest("/api/parts?barcode=CAP45", "GET"))).json();
    expect(body.part.id).toBe(other.part.id);
  });

  it("another organization's records are simply not found", async () => {
    as(other.manager, "MANAGER");
    const part = await import("@/app/api/parts/[id]/route");
    const res = await part.GET(await jsonRequest(`/api/parts/${s.capacitor.id}`, "GET"), {
      params: Promise.resolve({ id: s.capacitor.id }),
    });
    expect(res.status).toBe(404);

    const edit = await part.PATCH(await jsonRequest(`/api/parts/${s.capacitor.id}`, "PATCH", { name: "pwned" }), {
      params: Promise.resolve({ id: s.capacitor.id }),
    });
    expect(edit.status).toBe(404);
    expect((await s.prisma.part.findUniqueOrThrow({ where: { id: s.capacitor.id } })).name).toBe("Capacitor 45/5");
  });

  it("can't move stock on another organization's truck", async () => {
    as(other.manager, "MANAGER");
    const writeOff = await (await import("@/app/api/inventory/adjust/route")).POST(
      await jsonRequest("/api/inventory/adjust", "POST", { partId: s.capacitor.id, truckId: s.truck.id, quantity: 5, reason: "x" })
    );
    expect([403, 404]).toContain(writeOff.status);

    vi.resetModules();
    as(other.tech, "TRUCK_TECH");
    const consume = await (await import("@/app/api/inventory/consume/route")).POST(
      await jsonRequest("/api/inventory/consume", "POST", {
        truckId: s.truck.id,
        jobNumber: "J-1",
        items: [{ partId: s.capacitor.id, quantity: 1 }],
      })
    );
    expect(consume.status).toBe(404);
    expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(5);
  });

  it("can't deactivate or edit another organization's users", async () => {
    as(other.admin, "ADMIN");
    const { PATCH } = await import("@/app/api/users/[id]/route");
    const res = await PATCH(await jsonRequest(`/api/users/${s.tech.id}`, "PATCH", { active: false, password: "new-password-1" }), {
      params: Promise.resolve({ id: s.tech.id }),
    });
    expect(res.status).toBe(404);
    const tech = await s.prisma.user.findUniqueOrThrow({ where: { id: s.tech.id } });
    expect(tech.disabledAt).toBeNull();
  });

  it("reports only include your own organization's movements", async () => {
    // Test org uses 2 capacitors on a job.
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    await (await import("@/app/api/inventory/consume/route")).POST(
      await jsonRequest("/api/inventory/consume", "POST", {
        truckId: s.truck.id,
        jobNumber: "J-SAME",
        items: [{ partId: s.capacitor.id, quantity: 2 }],
      })
    );

    vi.resetModules();
    as(other.manager, "MANAGER");
    const { GET } = await import("@/app/api/reports/weekly/route");
    const today = new Date();
    const d = (x: Date) => x.toISOString().slice(0, 10);
    const res = await GET(
      await jsonRequest(
        `/api/reports/weekly?from=${d(new Date(today.getTime() - 2 * 864e5))}&to=${d(new Date(today.getTime() + 2 * 864e5))}`,
        "GET"
      )
    );
    const { summary } = await res.json();
    expect(summary.usedUnits ?? 0).toBe(0);
    expect(summary.byJob).toEqual([]);
  });

  it("the same job number in two organizations is two different jobs", async () => {
    mockAuthAs({ id: s.tech.id, role: "TRUCK_TECH" });
    const body = (truckId: string, partId: string) => ({ truckId, jobNumber: "WO-1", items: [{ partId, quantity: 1 }] });
    await (await import("@/app/api/inventory/consume/route")).POST(await jsonRequest("/api/inventory/consume", "POST", body(s.truck.id, s.capacitor.id)));

    await (await getPrisma(OTHER_ORG)).stockLevel.create({
      data: { partId: other.part.id, truckId: other.truck.id, locationType: "TRUCK", quantity: 1 },
    });
    vi.resetModules();
    as(other.tech, "TRUCK_TECH");
    const res = await (await import("@/app/api/inventory/consume/route")).POST(
      await jsonRequest("/api/inventory/consume", "POST", body(other.truck.id, other.part.id))
    );
    expect(res.status).toBe(201);
    const jobs = await (await getRawPrisma()).job.findMany({ where: { jobNumber: "WO-1" } });
    expect(jobs.map((j) => j.organizationId).sort()).toEqual([OTHER_ORG, TEST_ORG].sort());
  });

  it("company settings: admins of a company change only their own, and prices follow the markup", async () => {
    as(other.manager, "MANAGER");
    let mod = await import("@/app/api/organization/route");
    const denied = await mod.PATCH(await jsonRequest("/api/organization", "PATCH", { defaultMarkupPct: 50 }));
    expect(denied.status).toBe(403);

    vi.resetModules();
    as(other.admin, "ADMIN");
    mod = await import("@/app/api/organization/route");
    const saved = await mod.PATCH(await jsonRequest("/api/organization", "PATCH", { defaultMarkupPct: 50, name: "Other Co HVAC" }));
    expect(saved.status).toBe(200);
    const raw = await getRawPrisma();
    expect(Number((await raw.organization.findUniqueOrThrow({ where: { id: OTHER_ORG } })).defaultMarkupPct)).toBe(50);
    expect(Number((await raw.organization.findUniqueOrThrow({ where: { id: TEST_ORG } })).defaultMarkupPct)).toBe(25);

    // Their $99 capacitor now sells at $148.50; ours still at $12.50 + 25%.
    const part = await import("@/app/api/parts/[id]/route");
    const theirs = await (await part.GET(await jsonRequest(`/api/parts/${other.part.id}`, "GET"), {
      params: Promise.resolve({ id: other.part.id }),
    })).json();
    expect(theirs.pricing).toMatchObject({ unitPrice: 148.5, source: "markup", defaultMarkupPct: 50 });

    vi.resetModules();
    mockAuthAs({ id: s.manager.id, role: "MANAGER" });
    const ours = await (await (await import("@/app/api/parts/[id]/route")).GET(
      await jsonRequest(`/api/parts/${s.capacitor.id}`, "GET"),
      { params: Promise.resolve({ id: s.capacitor.id }) }
    )).json();
    expect(ours.pricing).toMatchObject({ unitPrice: 15.63, source: "markup", defaultMarkupPct: 25 });
  });

  it("fails closed: a query with no organization context is refused, not answered with everyone's data", async () => {
    const { prisma } = await import("@/lib/prisma");
    await expect(prisma.part.findMany()).rejects.toThrow(/no organization context/);
    // And an insert that somehow bypassed the app still can't create an orphan row.
    const raw = await getRawPrisma();
    await expect(
      raw.$executeRawUnsafe(`INSERT INTO "Job" ("id", "jobNumber") VALUES ('j_orphan', 'X')`)
    ).rejects.toThrow();
  });
});
