import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasDatabase, jsonRequest, resetDatabase } from "./setup";

describe.skipIf(!hasDatabase)("perimeter (real database)", () => {
  beforeEach(async () => {
    vi.resetModules();
    await resetDatabase();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rate limit counts across calls and resets after the window", async () => {
    const { rateLimit } = await import("@/lib/rate-limit");
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect((await rateLimit(key, 3, 60)).ok).toBe(true);
    const blocked = await rateLimit(key, 3, 60);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    // A 1-second window has expired by the next second.
    const short = `test:${Math.random()}`;
    await rateLimit(short, 1, 1);
    expect((await rateLimit(short, 1, 1)).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await rateLimit(short, 1, 1)).ok).toBe(true);
  });

  it("rate limit holds under concurrency", async () => {
    const { rateLimit } = await import("@/lib/rate-limit");
    const key = `test:${Math.random()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => rateLimit(key, 5, 60)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });

  it("setup requires SETUP_TOKEN when configured, and only one super admin wins a race", async () => {
    vi.stubEnv("SETUP_TOKEN", "correct-horse-battery-staple");
    const { POST } = await import("@/app/api/setup/route");
    const body = { name: "Owner", email: "owner@test.local", password: "long-enough-pw" };

    const noToken = await POST(await jsonRequest("/api/setup", "POST", body));
    expect(noToken.status).toBe(403);
    const wrong = await POST(await jsonRequest("/api/setup", "POST", { ...body, setupToken: "nope" }));
    expect(wrong.status).toBe(403);

    const [a, b] = await Promise.all([
      POST(await jsonRequest("/api/setup", "POST", { ...body, setupToken: "correct-horse-battery-staple" })),
      POST(
        await jsonRequest("/api/setup", "POST", {
          ...body,
          email: "intruder@test.local",
          setupToken: "correct-horse-battery-staple",
        })
      ),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const { getPrisma } = await import("./setup");
    expect(await (await getPrisma()).user.count({ where: { role: "SUPER_ADMIN" } })).toBe(1);
  });

  it("forgot-password is rate limited per address", async () => {
    const { POST } = await import("@/app/api/auth/forgot/route");
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await POST(await jsonRequest("/api/auth/forgot", "POST", { email: "someone@test.local" }))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});
