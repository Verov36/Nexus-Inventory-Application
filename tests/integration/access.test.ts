import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { hasDatabase, jsonRequest, mockAuthAs, resetDatabase, seedBasics, type Seeded } from "./setup";

// Revoking access: deactivation, password changes and resets must end
// sessions that were issued before them, on the very next request.

describe.skipIf(!hasDatabase)("access revocation (real database)", () => {
  let s: Seeded;

  beforeEach(async () => {
    vi.resetModules();
    await resetDatabase();
    s = await seedBasics();
  });

  async function claimsFor(userId: string) {
    const u = await s.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { sub: u.id, sv: u.sessionVersion, authAt: Math.floor(Date.now() / 1000) };
  }

  it("a live session picks up role changes on the next request", async () => {
    const { revalidateSession } = await import("@/lib/session");
    const token = await claimsFor(s.manager.id);
    await s.prisma.user.update({ where: { id: s.manager.id }, data: { role: "TRUCK_TECH" } });
    const fresh = await revalidateSession({ ...token, role: "MANAGER" });
    expect(fresh?.role).toBe("TRUCK_TECH");
  });

  it("deactivating a user ends their session and blocks reactivating it by version", async () => {
    const admin = await s.prisma.user.create({
      data: { name: "Ada Admin", email: "admin@test.local", passwordHash: "x", role: "ADMIN" },
    });
    const techToken = await claimsFor(s.tech.id);

    mockAuthAs({ id: admin.id, role: "ADMIN" });
    const { PATCH } = await import("@/app/api/users/[id]/route");
    const res = await PATCH(await jsonRequest(`/api/users/${s.tech.id}`, "PATCH", { active: false }), {
      params: Promise.resolve({ id: s.tech.id }),
    });
    expect(res.status).toBe(200);

    const { revalidateSession } = await import("@/lib/session");
    expect(await revalidateSession({ ...techToken })).toBeNull();
    // Their truck is freed for someone else.
    expect((await s.prisma.truck.findUniqueOrThrow({ where: { id: s.truck.id } })).techId).toBeNull();

    // Reactivating doesn't resurrect the old session — it was issued before the bump.
    const again = await PATCH(await jsonRequest(`/api/users/${s.tech.id}`, "PATCH", { active: true }), {
      params: Promise.resolve({ id: s.tech.id }),
    });
    expect(again.status).toBe(200);
    expect(await revalidateSession({ ...techToken })).toBeNull();
  });

  it("an admin can't deactivate themselves, and a manager can't deactivate anyone", async () => {
    mockAuthAs({ id: s.manager.id, role: "MANAGER" });
    let mod = await import("@/app/api/users/[id]/route");
    const asManager = await mod.PATCH(await jsonRequest(`/api/users/${s.tech.id}`, "PATCH", { active: false }), {
      params: Promise.resolve({ id: s.tech.id }),
    });
    expect(asManager.status).toBe(403);

    const admin = await s.prisma.user.create({
      data: { name: "Ada Admin", email: "admin@test.local", passwordHash: "x", role: "ADMIN" },
    });
    vi.resetModules();
    mockAuthAs({ id: admin.id, role: "ADMIN" });
    mod = await import("@/app/api/users/[id]/route");
    const self = await mod.PATCH(await jsonRequest(`/api/users/${admin.id}`, "PATCH", { active: false }), {
      params: Promise.resolve({ id: admin.id }),
    });
    expect(self.status).toBe(400);
  });

  it("an admin setting someone's password signs that person out everywhere", async () => {
    const admin = await s.prisma.user.create({
      data: { name: "Ada Admin", email: "admin@test.local", passwordHash: "x", role: "ADMIN" },
    });
    const techToken = await claimsFor(s.tech.id);
    mockAuthAs({ id: admin.id, role: "ADMIN" });
    const { PATCH } = await import("@/app/api/users/[id]/route");
    await PATCH(await jsonRequest(`/api/users/${s.tech.id}`, "PATCH", { password: "brand-new-pass" }), {
      params: Promise.resolve({ id: s.tech.id }),
    });
    const { revalidateSession } = await import("@/lib/session");
    expect(await revalidateSession({ ...techToken })).toBeNull();
  });

  it("a session older than the absolute lifetime ends even if the account is fine", async () => {
    const { revalidateSession } = await import("@/lib/session");
    const token = await claimsFor(s.tech.id);
    expect(await revalidateSession({ ...token })).not.toBeNull();
    expect(await revalidateSession({ ...token, authAt: token.authAt - 8 * 24 * 60 * 60 })).toBeNull();
  });

  it("a reset link works once, and signs out existing sessions", async () => {
    const techToken = await claimsFor(s.tech.id);
    const raw = "a".repeat(64);
    await s.prisma.passwordResetToken.create({
      data: {
        userId: s.tech.id,
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    const { POST } = await import("@/app/api/auth/reset/route");
    const [a, b] = await Promise.all([
      POST(await jsonRequest("/api/auth/reset", "POST", { token: raw, password: "first-password" })),
      POST(await jsonRequest("/api/auth/reset", "POST", { token: raw, password: "second-password" })),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);

    const { revalidateSession } = await import("@/lib/session");
    expect(await revalidateSession({ ...techToken })).toBeNull();
  });

  it("a deactivated user's reset link is refused", async () => {
    const raw = "b".repeat(64);
    await s.prisma.user.update({ where: { id: s.tech.id }, data: { disabledAt: new Date() } });
    await s.prisma.passwordResetToken.create({
      data: {
        userId: s.tech.id,
        tokenHash: createHash("sha256").update(raw).digest("hex"),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    const { POST } = await import("@/app/api/auth/reset/route");
    const res = await POST(await jsonRequest("/api/auth/reset", "POST", { token: raw, password: "whatever-pass" }));
    expect(res.status).toBe(400);
  });
});
