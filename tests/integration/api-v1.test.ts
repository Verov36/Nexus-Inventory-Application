import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { TEST_ORG, getPrisma, getRawPrisma, hasDatabase, resetDatabase, seedBasics, truckQty, type Seeded } from "./setup";

// The Field App integration, called exactly the way the Field App will call it.

const PLATFORM_KEY = "platform-secret-for-tests-only";

function call(path: string, method: string, opts: { key?: string; body?: unknown; idem?: string } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.idem ? { "Idempotency-Key": opts.idem } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

describe.skipIf(!hasDatabase)("/api/v1 (real database)", () => {
  let s: Seeded;
  let key: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("INVENTORY_PLATFORM_KEY", PLATFORM_KEY);
    await resetDatabase();
    s = await seedBasics();
    await s.prisma.stockLevel.createMany({
      data: [
        { partId: s.capacitor.id, truckId: s.truck.id, locationType: "TRUCK", quantity: 5 },
        { partId: s.filter.id, truckId: s.truck.id, locationType: "TRUCK", quantity: 2 },
      ],
    });
    const { runAsOrg } = await import("@/lib/tenant");
    const { issueApiKey } = await import("@/lib/api-keys");
    const { prisma } = await import("@/lib/prisma");
    key = (await runAsOrg(TEST_ORG, () => prisma.$transaction((tx) => issueApiKey(tx, "Field App")))).key;
    // Tom (the seeded tech) rides Truck 1 as Field App user fa-tom.
    const assign = await import("@/app/api/v1/trucks/[truckId]/assignment/route");
    const res = await assign.PUT(
      call(`/api/v1/trucks/${s.truck.id}/assignment`, "PUT", { key, body: { crew: [{ externalUserId: "fa-tom", name: "Tom Tech" }] } }),
      params({ truckId: s.truck.id })
    );
    expect(res.status).toBe(200);
  });
  afterEach(() => vi.unstubAllEnvs());

  async function use(body: Record<string, unknown>, idem?: string, jobId = "fa-job-1", k = key) {
    const { POST } = await import("@/app/api/v1/jobs/[externalJobId]/parts-used/route");
    return POST(call(`/api/v1/jobs/${jobId}/parts-used`, "POST", { key: k, body, idem }), params({ externalJobId: jobId }));
  }
  async function listUsed(jobId = "fa-job-1", k = key) {
    const { GET } = await import("@/app/api/v1/jobs/[externalJobId]/parts-used/route");
    return (await GET(call(`/api/v1/jobs/${jobId}/parts-used`, "GET", { key: k }), params({ externalJobId: jobId }))).json();
  }
  async function reverse(lineId: string, body: Record<string, unknown>, idem?: string, jobId = "fa-job-1") {
    const { POST } = await import("@/app/api/v1/jobs/[externalJobId]/parts-used/[lineId]/reverse/route");
    return POST(
      call(`/api/v1/jobs/${jobId}/parts-used/${lineId}/reverse`, "POST", { key, body, idem }),
      params({ externalJobId: jobId, lineId })
    );
  }
  const usedBody = (over: Record<string, unknown> = {}) => ({
    jobNumber: "WO-900",
    truckId: s.truck.id,
    usedBy: { externalUserId: "fa-tom", name: "Tom Tech" },
    items: [{ partId: s.capacitor.id, quantity: 2 }],
    ...over,
  });

  describe("authentication", () => {
    it("refuses missing, malformed, revoked and expired keys", async () => {
      const { GET } = await import("@/app/api/v1/parts/route");
      expect((await GET(call("/api/v1/parts", "GET"), params({}))).status).toBe(401);
      expect((await GET(call("/api/v1/parts", "GET", { key: "inv_live_nope" }), params({}))).status).toBe(401);
      expect((await GET(call("/api/v1/parts", "GET", { key }), params({}))).status).toBe(200);

      const prisma = await getPrisma();
      await prisma.apiKey.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await GET(call("/api/v1/parts", "GET", { key }), params({}))).status).toBe(401);
      await prisma.apiKey.updateMany({ data: { expiresAt: null, revokedAt: new Date() } });
      const res = await GET(call("/api/v1/parts", "GET", { key }), params({}));
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("unauthorized");
    });

    it("stores only a hash of the key", async () => {
      const rows = await (await getPrisma()).apiKey.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].hash).not.toContain(key);
      expect(key.startsWith(rows[0].prefix)).toBe(true);
    });
  });

  describe("provisioning", () => {
    it("needs the platform key", async () => {
      const { PUT } = await import("@/app/api/v1/provision/orgs/[externalOrgId]/route");
      const body = { name: "Acme HVAC", branches: [{ externalId: "fa-br-1", name: "North" }] };
      expect((await PUT(call("/api/v1/provision/orgs/fa-org-1", "PUT", { body }), params({ externalOrgId: "fa-org-1" }))).status).toBe(401);
      // An organization API key is not a platform key.
      expect((await PUT(call("/api/v1/provision/orgs/fa-org-1", "PUT", { key, body }), params({ externalOrgId: "fa-org-1" }))).status).toBe(401);
      vi.stubEnv("INVENTORY_PLATFORM_KEY", "");
      expect((await PUT(call("/api/v1/provision/orgs/fa-org-1", "PUT", { key: PLATFORM_KEY, body }), params({ externalOrgId: "fa-org-1" }))).status).toBe(503);
    });

    it("creates the organization once, adds branches later, and rotates keys without an outage", async () => {
      const { PUT } = await import("@/app/api/v1/provision/orgs/[externalOrgId]/route");
      const p = params({ externalOrgId: "fa-org-1" });
      const first = await PUT(
        call("/api/v1/provision/orgs/fa-org-1", "PUT", {
          key: PLATFORM_KEY,
          body: { name: "Acme HVAC", branches: [{ externalId: "fa-br-1", name: "North", timezone: "America/Chicago" }] },
        }),
        p
      );
      expect(first.status).toBe(201);
      const created = await first.json();
      expect(created.apiKey).toMatch(/^inv_live_/);
      expect(created.branches).toEqual([expect.objectContaining({ externalId: "fa-br-1", name: "North" })]);

      const again = await PUT(
        call("/api/v1/provision/orgs/fa-org-1", "PUT", {
          key: PLATFORM_KEY,
          body: { name: "Acme HVAC Inc", branches: [{ externalId: "fa-br-1", name: "North" }, { externalId: "fa-br-2", name: "South" }] },
        }),
        p
      );
      expect(again.status).toBe(200);
      const updated = await again.json();
      expect(updated.apiKey).toBeUndefined();
      expect(updated.branches.map((b: { externalId: string }) => b.externalId)).toEqual(["fa-br-1", "fa-br-2"]);
      const raw = await getRawPrisma();
      const org = await raw.organization.findUniqueOrThrow({ where: { externalId: "fa-org-1" } });
      expect(org.name).toBe("Acme HVAC Inc");
      // Every branch has a warehouse to receive into.
      expect(await raw.warehouse.count({ where: { organizationId: org.id } })).toBe(2);

      const rotated = await (
        await PUT(
          call("/api/v1/provision/orgs/fa-org-1", "PUT", {
            key: PLATFORM_KEY,
            body: { name: "Acme HVAC Inc", branches: [{ externalId: "fa-br-1", name: "North" }], rotateKey: true },
          }),
          p
        )
      ).json();
      expect(rotated.apiKey).toMatch(/^inv_live_/);
      expect(rotated.apiKey).not.toBe(created.apiKey);
      // Both keys work during the changeover, and each sees only its own (empty) catalog.
      const { GET } = await import("@/app/api/v1/parts/route");
      for (const k of [created.apiKey, rotated.apiKey]) {
        const res = await GET(call("/api/v1/parts", "GET", { key: k }), params({}));
        expect(res.status).toBe(200);
        expect((await res.json()).parts).toEqual([]);
      }
      const old = await raw.apiKey.findFirstOrThrow({ where: { organizationId: org.id, prefix: created.apiKey.slice(0, 15) } });
      expect(old.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("catalog and trucks", () => {
    it("searches the catalog with prices and pages through it", async () => {
      const { GET } = await import("@/app/api/v1/parts/route");
      const found = await (await GET(call("/api/v1/parts?q=cap", "GET", { key }), params({}))).json();
      expect(found.parts).toEqual([
        expect.objectContaining({ id: s.capacitor.id, sku: "CAP-45", unitCost: 12.5, unitPrice: 15.63, priceSource: "markup" }),
      ]);
      const page1 = await (await GET(call("/api/v1/parts?limit=1", "GET", { key }), params({}))).json();
      expect(page1.parts).toHaveLength(1);
      expect(page1.nextCursor).toBeTruthy();
      const page2 = await (await GET(call(`/api/v1/parts?limit=1&cursor=${page1.nextCursor}`, "GET", { key }), params({}))).json();
      expect(page2.parts).toHaveLength(1);
      expect(page2.parts[0].id).not.toBe(page1.parts[0].id);
      expect(page2.nextCursor).toBeNull();
    });

    it("finds a tech's truck and its live stock", async () => {
      const trucks = await import("@/app/api/v1/trucks/route");
      const mine = await (await trucks.GET(call("/api/v1/trucks?externalUserId=fa-tom", "GET", { key }), params({}))).json();
      expect(mine.trucks.map((t: { id: string }) => t.id)).toEqual([s.truck.id]);

      const stock = await import("@/app/api/v1/trucks/[truckId]/stock/route");
      const body = await (await stock.GET(call(`/api/v1/trucks/${s.truck.id}/stock`, "GET", { key }), params({ truckId: s.truck.id }))).json();
      expect(body.stock.map((l: { quantity: number; part: { sku: string } }) => [l.part.sku, l.quantity])).toEqual([
        ["CAP-45", 5],
        ["FLT-16", 2],
      ]);
    });
  });

  describe("parts used on a job", () => {
    it("requires an Idempotency-Key", async () => {
      const res = await use(usedBody());
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("idempotency_key_required");
    });

    it("records parts off the truck with frozen cost and price, and a retry is a replay", async () => {
      const res = await use(usedBody(), "idem-1");
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.lines).toEqual([
        expect.objectContaining({ partId: s.capacitor.id, quantity: 2, unitCost: 12.5, unitPrice: 15.63, remainingOnTruck: 3 }),
      ]);
      expect(body.replayed).toBe(false);

      const retry = await (await use(usedBody(), "idem-1")).json();
      expect(retry.replayed).toBe(true);
      expect(retry.lines[0].lineId).toBe(body.lines[0].lineId);
      expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(3);

      // Recorded under the integration account, with the real tech named.
      const row = await (await getPrisma()).inventoryTransaction.findFirstOrThrow({ where: { type: "CONSUME" }, include: { performedBy: true } });
      expect(row.performedBy.isServiceAccount).toBe(true);
      expect(row.performedByName).toBe("Tom Tech");

      // A later price change doesn't rewrite what this job cost or bills.
      await (await getPrisma()).part.update({ where: { id: s.capacitor.id }, data: { unitCost: "99.00" } });
      const listed = await listUsed();
      expect(listed.lines[0]).toMatchObject({ quantity: 2, unitCost: 12.5, unitPrice: 15.63, lineCost: 25, linePrice: 31.26 });
      expect(listed.totals).toEqual({ cost: 25, price: 31.26, unpricedLines: 0 });
    });

    it("only for someone on the truck's crew, unless a manager records it on their behalf", async () => {
      const stranger = await use(usedBody({ usedBy: { externalUserId: "fa-someone-else" } }), "idem-2");
      expect(stranger.status).toBe(403);
      expect((await stranger.json()).code).toBe("not_assigned_to_truck");
      const dispatcher = await use(usedBody({ usedBy: { externalUserId: "fa-dispatch" }, onBehalf: true }), "idem-3");
      expect(dispatcher.status).toBe(201);
    });

    it("reports a short truck with a code the Field App can act on, and moves nothing", async () => {
      const res = await use(usedBody({ items: [{ partId: s.filter.id, quantity: 3 }] }), "idem-4");
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "insufficient_stock", available: 2, requested: 3 });
      expect(await truckQty(s.filter.id, s.truck.id)).toBe(2);
    });

    it("the same job number on a different Field App job is a conflict, not a merge", async () => {
      expect((await use(usedBody(), "idem-5", "fa-job-1")).status).toBe(201);
      const other = await use(usedBody(), "idem-6", "fa-job-2");
      expect(other.status).toBe(409);
      expect((await other.json()).code).toBe("job_number_conflict");
    });

    it("an unknown job simply has no parts yet", async () => {
      const listed = await listUsed("fa-never-seen");
      expect(listed.lines).toEqual([]);
    });
  });

  describe("reversing parts used", () => {
    it("puts parts back on the truck, never more than were used, even concurrently", async () => {
      const used = await (await use(usedBody({ items: [{ partId: s.capacitor.id, quantity: 3 }] }), "idem-7")).json();
      const lineId = used.lines[0].lineId;
      expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(2);

      const first = await reverse(lineId, { quantity: 1, reason: "wrong size" }, "rev-1");
      expect(first.status).toBe(201);
      expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(3);

      // Two reversals of 2 at once: only 2 remain reversible, so one must fail.
      const [a, b] = await Promise.all([
        reverse(lineId, { quantity: 2, reason: "not installed" }, "rev-2"),
        reverse(lineId, { quantity: 2, reason: "not installed" }, "rev-3"),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(5);

      const listed = await listUsed();
      expect(listed.lines[0]).toMatchObject({ quantityUsed: 3, quantityReversed: 3, quantity: 0, lineCost: 0 });
      expect(listed.totals.cost).toBe(0);

      // Retrying the first reversal replays it rather than moving stock again.
      const retry = await reverse(lineId, { quantity: 1, reason: "wrong size" }, "rev-1");
      expect((await retry.json()).replayed).toBe(true);
      expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(5);
    });

    it("can't reverse a line through a different job", async () => {
      const used = await (await use(usedBody(), "idem-8")).json();
      const res = await reverse(used.lines[0].lineId, { quantity: 1, reason: "x" }, "rev-4", "fa-job-other");
      expect(res.status).toBe(404);
    });

    it("usage reports net out reversals at the frozen cost", async () => {
      const used = await (await use(usedBody({ items: [{ partId: s.capacitor.id, quantity: 3 }] }), "idem-9")).json();
      await reverse(used.lines[0].lineId, { quantity: 1, reason: "not installed" }, "rev-5");
      const { runAsOrg } = await import("@/lib/tenant");
      const { generateUsageSummary } = await import("@/lib/reports");
      const summary = await runAsOrg(TEST_ORG, () => generateUsageSummary(new Date(Date.now() - 60_000), new Date(Date.now() + 60_000)));
      expect(summary.usedUnits).toBe(2);
      expect(summary.usedCost).toBe(25);
      expect(summary.byJob).toEqual([expect.objectContaining({ jobNumber: "WO-900", cost: 25 })]);
      expect(summary.byTech.map((t) => t.tech)).toContain("Tom Tech");
    });
  });

  describe("cutover import", () => {
    it("provisioning creates the company's first login once, and never takes an email another company uses", async () => {
      const { PUT } = await import("@/app/api/v1/provision/orgs/[externalOrgId]/route");
      const provision = (org: string, email: string) =>
        PUT(
          call(`/api/v1/provision/orgs/${org}`, "PUT", {
            key: PLATFORM_KEY,
            body: { name: "Acme", branches: [{ externalId: "b1", name: "North" }], owner: { name: "Pat Owner", email } },
          }),
          params({ externalOrgId: org })
        ).then((r) => r.json());
      expect((await provision("fa-org-1", "pat@acme.test")).owner).toEqual({ status: "created", passwordLinkSent: false });
      expect((await provision("fa-org-1", "pat@acme.test")).owner.status).toBe("exists");
      // Tom already has an account in the test company.
      expect((await provision("fa-org-2", "tech@test.local")).owner.status).toBe("email_in_use");

      const raw = await getRawPrisma();
      const pat = await raw.user.findUniqueOrThrow({ where: { email: "pat@acme.test" }, include: { organization: true } });
      expect(pat.role).toBe("SUPER_ADMIN");
      expect(pat.organization.externalId).toBe("fa-org-1");
    });

    it("imports parts by SKU, safe to re-run, reporting bad rows individually", async () => {
      const { PUT } = await import("@/app/api/v1/parts/route");
      const send = (parts: unknown[]) => PUT(call("/api/v1/parts", "PUT", { key, body: { parts } }), params({})).then((r) => r.json());
      const first = await send([
        { sku: "TXV-3T", name: "TXV 3 ton", unitCost: 88, category: "Refrigeration" },
        { sku: "CAP-45", name: "Capacitor 45/5 MFD (renamed)" },
        { sku: "BAD-1", name: "Clashes", barcode: "FLT16" },
      ]);
      expect(first.results.map((r: { status: string }) => r.status)).toEqual(["created", "updated", "error"]);
      const again = await send([{ sku: "TXV-3T", name: "TXV 3 ton", unitCost: 90 }]);
      expect(again.results[0]).toMatchObject({ status: "updated", id: first.results[0].id });
      const prisma = await getPrisma();
      expect(Number((await prisma.part.findFirstOrThrow({ where: { sku: "TXV-3T" } })).unitCost)).toBe(90);
      expect((await prisma.part.findUniqueOrThrow({ where: { id: s.capacitor.id } })).name).toBe("Capacitor 45/5 MFD (renamed)");
    });

    it("imports trucks by their Field App id and sets opening stock (set, not add)", async () => {
      const prisma = await getPrisma();
      await prisma.branch.update({ where: { id: "branch_test" }, data: { externalId: "fa-br-test" } });
      const { PUT } = await import("@/app/api/v1/trucks/external/[externalTruckId]/route");
      const upsert = (body: unknown) =>
        PUT(call("/api/v1/trucks/external/fa-truck-9", "PUT", { key, body }), params({ externalTruckId: "fa-truck-9" }));
      const made = await upsert({ label: "Truck 9", branchExternalId: "fa-br-test" });
      expect(made.status).toBe(201);
      const truckId = (await made.json()).truck.id;
      const again = await upsert({ label: "Truck 9 (van)", branchExternalId: "fa-br-test" });
      expect(again.status).toBe(200);
      expect((await again.json()).truck.id).toBe(truckId);
      expect((await upsert({ label: "x", branchExternalId: "nope" })).status).toBe(404);

      const opening = await import("@/app/api/v1/trucks/[truckId]/opening-stock/route");
      const setStock = (items: unknown[], idem: string) =>
        opening.POST(call(`/api/v1/trucks/${truckId}/opening-stock`, "POST", { key, body: { items }, idem }), params({ truckId }));
      expect((await setStock([{ partId: s.capacitor.id, quantity: 4 }], "open-1")).status).toBe(200);
      expect(await truckQty(s.capacitor.id, truckId)).toBe(4);
      expect((await (await setStock([{ partId: s.capacitor.id, quantity: 4 }], "open-1")).json()).replayed).toBe(true);
      await setStock([{ partId: s.capacitor.id, quantity: 6 }], "open-2");
      expect(await truckQty(s.capacitor.id, truckId)).toBe(6);
      const ledger = await prisma.inventoryTransaction.findMany({ where: { toTruckId: truckId }, orderBy: { createdAt: "asc" } });
      expect(ledger.map((t) => [t.type, t.quantity, t.notes])).toEqual([
        ["ADJUSTMENT", 4, "Opening balance imported from the Field App"],
        ["ADJUSTMENT", 2, "Opening balance imported from the Field App"],
      ]);
    });
  });

  describe("key management by admins", () => {
    it("admins create and revoke keys; managers can't; revoking takes effect at once", async () => {
      const { mockAuthAs, jsonRequest } = await import("./setup");
      mockAuthAs({ id: s.manager.id, role: "MANAGER" });
      let keys = await import("@/app/api/api-keys/route");
      expect((await keys.POST(await jsonRequest("/api/api-keys", "POST", { name: "x" }))).status).toBe(403);

      const admin = await s.prisma.user.create({ data: { name: "Ada", email: "ada@test.local", passwordHash: "x", role: "ADMIN" } });
      vi.resetModules();
      mockAuthAs({ id: admin.id, role: "ADMIN" });
      keys = await import("@/app/api/api-keys/route");
      const made = await (await keys.POST(await jsonRequest("/api/api-keys", "POST", { name: "Second system" }))).json();
      expect(made.key).toMatch(/^inv_live_/);
      const listed = await (await keys.GET()).json();
      expect(JSON.stringify(listed)).not.toContain(made.key);
      expect(listed.keys).toHaveLength(2);

      const { GET } = await import("@/app/api/v1/parts/route");
      expect((await GET(call("/api/v1/parts", "GET", { key: made.key }), params({}))).status).toBe(200);
      const one = await import("@/app/api/api-keys/[id]/route");
      expect((await one.DELETE(await jsonRequest(`/api/api-keys/${made.record.id}`, "DELETE"), params({ id: made.record.id }))).status).toBe(200);
      expect((await GET(call("/api/v1/parts", "GET", { key: made.key }), params({}))).status).toBe(401);
      // The other key is untouched.
      expect((await GET(call("/api/v1/parts", "GET", { key }), params({}))).status).toBe(200);
    });
  });

  describe("organization isolation", () => {
    it("one organization's key can't see or touch another's trucks, stock or jobs", async () => {
      const { PUT } = await import("@/app/api/v1/provision/orgs/[externalOrgId]/route");
      const other = await (
        await PUT(
          call("/api/v1/provision/orgs/fa-org-x", "PUT", { key: PLATFORM_KEY, body: { name: "Other", branches: [{ externalId: "b", name: "B" }] } }),
          params({ externalOrgId: "fa-org-x" })
        )
      ).json();
      const otherKey = other.apiKey as string;

      await use(usedBody(), "idem-10");

      const stock = await import("@/app/api/v1/trucks/[truckId]/stock/route");
      expect((await stock.GET(call(`/api/v1/trucks/${s.truck.id}/stock`, "GET", { key: otherKey }), params({ truckId: s.truck.id }))).status).toBe(404);

      const steal = await use(usedBody({ onBehalf: true }), "idem-11", "fa-job-1", otherKey);
      expect(steal.status).toBe(404);
      expect(await truckQty(s.capacitor.id, s.truck.id)).toBe(3);

      expect((await listUsed("fa-job-1", otherKey)).lines).toEqual([]);

      const parts = await import("@/app/api/v1/parts/[id]/route");
      expect((await parts.GET(call(`/api/v1/parts/${s.capacitor.id}`, "GET", { key: otherKey }), params({ id: s.capacitor.id }))).status).toBe(404);
    });
  });
});
