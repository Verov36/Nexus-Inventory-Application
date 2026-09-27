import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { runAsOrg, runUnscoped } from "@/lib/tenant";
import { createOrganization } from "@/lib/organizations";

// First-run setup. Only does anything while the database has zero users —
// the moment the first super admin exists this endpoint is inert, so it
// can't be used to add accounts later.
//
// In production it also requires SETUP_TOKEN from the deployment's
// environment. Without that, whoever reached a fresh (or restored-empty)
// deployment's URL first would become its super admin.

function setupTokenRequired() {
  return process.env.NODE_ENV === "production" || !!process.env.SETUP_TOKEN;
}

function setupTokenMatches(given: string | undefined) {
  const expected = process.env.SETUP_TOKEN;
  if (!expected) return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(given ?? "").digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET() {
  const users = await runUnscoped("first-run check", () => prisma.user.count());
  return NextResponse.json({
    needsSetup: users === 0,
    setupTokenRequired: setupTokenRequired(),
    setupTokenConfigured: !!process.env.SETUP_TOKEN,
  });
}

const setupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  organizationName: z.string().trim().min(1).max(120).default("My company"),
  warehouseName: z.string().trim().min(1).max(120).default("Main warehouse"),
  setupToken: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`setup:ip:${clientIp(req.headers)}`, 10, 15 * 60);
  if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (setupTokenRequired()) {
    if (!process.env.SETUP_TOKEN) {
      return NextResponse.json(
        { error: "Set SETUP_TOKEN in this deployment's environment variables, redeploy, then enter it here." },
        { status: 503 }
      );
    }
    if (!setupTokenMatches(parsed.data.setupToken)) {
      return NextResponse.json({ error: "Setup token didn't match SETUP_TOKEN." }, { status: 403 });
    }
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  try {
    // First-run setup looks across the whole install (is there anyone at
    // all?) and creates the first organization, so it runs unscoped.
    const result = await runUnscoped("first-run setup", () =>
      prisma.$transaction(async (tx) => {
        // Serialize setup: at READ COMMITTED two concurrent transactions could
        // both count zero users. The advisory lock makes the second one wait,
        // then see the first one's user.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(8675309)`;
        const users = await tx.user.count();
        if (users > 0) throw new AlreadySetUp();

        // A database migrated from before organizations existed already has
        // one (with the old data but no users yet); adopt it.
        const existing = await tx.organization.findFirst({ orderBy: { createdAt: "asc" } });
        const { organization, warehouse } = existing
          ? {
              organization: existing,
              warehouse: await runAsOrg(existing.id, () =>
                tx.warehouse.findFirstOrThrow({ orderBy: { createdAt: "asc" } })
              ),
            }
          : await createOrganization(tx, {
              name: parsed.data.organizationName,
              branch: { name: "Main branch" },
              warehouseName: parsed.data.warehouseName,
            });

        const user = await runAsOrg(organization.id, () =>
          tx.user.create({
            data: { name: parsed.data.name, email: parsed.data.email, passwordHash, role: "SUPER_ADMIN" },
            select: { id: true, email: true },
          })
        );
        return { user, warehouse };
      })
    );

    return NextResponse.json({ ok: true, warehouseId: result.warehouse.id, email: result.user.email }, { status: 201 });
  } catch (err) {
    if (err instanceof AlreadySetUp) {
      return NextResponse.json({ error: "This app is already set up — sign in instead." }, { status: 409 });
    }
    console.error("Setup failed:", err);
    return NextResponse.json({ error: "Setup failed — check the database connection and try again." }, { status: 500 });
  }
}

class AlreadySetUp extends Error {}
