import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Static checks that keep organization isolation from being bypassed by a
// new route or a stray import. Organization scoping only protects code that
// goes through it.

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");

// Routes with no signed-in session: each one sets its own organization
// context (runUnscoped / runAsOrg) and is reviewed individually.
const PUBLIC_ROUTES = new Set([
  "app/api/auth/[...nextauth]/route.ts",
  "app/api/auth/forgot/route.ts",
  "app/api/auth/reset/route.ts",
  "app/api/cron/weekly-report/route.ts",
  "app/api/health/route.ts",
  "app/api/setup/route.ts",
]);

describe("organization isolation guards", () => {
  const routes = walk(path.join(ROOT, "app/api")).filter((f) => f.endsWith("route.ts"));

  it("every signed-in API route is exported through withOrg", () => {
    const offenders: string[] = [];
    for (const file of routes) {
      const name = rel(file);
      if (PUBLIC_ROUTES.has(name)) continue;
      const src = fs.readFileSync(file, "utf8");
      if (/export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/.test(src)) offenders.push(name);
      for (const m of src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=\s*(\w+)\(/g)) {
        if (m[2] !== "withOrg") offenders.push(`${name} (${m[1]})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("app code never uses the unscoped database client", () => {
    const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "components"))]
      .filter((f) => /\.(ts|tsx)$/.test(f) && rel(f) !== "lib/prisma.ts");
    const offenders = files
      .filter((f) => /\b(rawPrisma|prismaForOrg)\b|new PrismaClient\(/.test(fs.readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("every runUnscoped call says why", () => {
    const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "lib"))].filter((f) => /\.tsx?$/.test(f));
    const bare = files.flatMap((f) =>
      [...fs.readFileSync(f, "utf8").matchAll(/runUnscoped\(\s*([^,)]*)/g)]
        .filter((m) => rel(f) !== "lib/tenant.ts" && !/^["'`].{5,}/.test(m[1].trim()))
        .map(() => rel(f))
    );
    expect(bare).toEqual([]);
  });
});
